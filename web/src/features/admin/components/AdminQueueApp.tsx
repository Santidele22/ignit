import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { signOutCleanly } from '../../auth/api/authActions';
import { BookClutterPanel } from './BookClutterPanel';
import { FirewallPipeline } from './FirewallPipeline';
import { StyleReferenceSection } from './StyleReferenceSection';
import {
	ADMIN_QUEUE_PAGE_SIZE,
	fetchAdminQueue,
	submitAdminReview,
	unpublishAdminBook,
} from '../lib/admin-api';
import {
	adminAiVerdict,
	adminKindLabel,
	adminQueueWindow,
	formatAdminFileSize,
	formatAdminRelativeTime,
	type AdminQueueBook,
	type AdminQueuePage,
} from '../lib/admin-queue';

/**
 * Admin review dashboard (`/admin`, S5).
 *
 * Renders the pending PDF queue the backend exposes at `GET /admin/books` and
 * records each decision through `POST /admin/books/:id/review`. The page
 * itself is SSR-gated (`admin.astro`), so this component only ever mounts for
 * an admin session.
 *
 * Decisions are two-step and inline (never `window.confirm`), mirroring
 * `EditBookModal`: the first press arms the row, the second confirms, and
 * `Escape` (or «Cancelar») disarms it without touching the backend. Every
 * announced result goes through the `aria-live="polite"` region, and the queue
 * plus its pending counter reload after each decision.
 *
 * CSP: no inline `<script>`; all state lives in this bundled module.
 */
export interface AdminQueueAppProps {
	userLabel: string;
}

type ArmedRow = { id: number; mode: 'approve' | 'reject' | 'unpublish' };
type AdminViewMode = 'pending' | 'published';

const LOAD_ERROR = 'No se pudo cargar la cola de revisión.';
const DECISION_ERROR = 'No se pudo registrar la decisión.';
const UNPUBLISH_ERROR = 'No se pudo despublicar el libro.';

export default function AdminQueueApp(props: AdminQueueAppProps) {
	const [view, setView] = createSignal<AdminViewMode>('pending');
	const [queue, setQueue] = createSignal<AdminQueuePage | null>(null);
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal<string | null>(null);
	const [page, setPage] = createSignal(1);
	const [busyId, setBusyId] = createSignal<number | null>(null);
	const [armed, setArmed] = createSignal<ArmedRow | null>(null);
	const [publishOnApprove, setPublishOnApprove] = createSignal(false);
	const [note, setNote] = createSignal('');
	const [announcement, setAnnouncement] = createSignal('');
	const [signingOut, setSigningOut] = createSignal(false);
	const [pipelineId, setPipelineId] = createSignal<number | null>(null);
	const [clutterId, setClutterId] = createSignal<number | null>(null);
	const [phaseChecks, setPhaseChecks] = createSignal<Record<number, { security: boolean; design: boolean }>>({});

	function getPhases(bookId: number) {
		return phaseChecks()[bookId] ?? { security: false, design: false };
	}

	function togglePhase(bookId: number, phase: 'security' | 'design', checked: boolean) {
		setPhaseChecks((prev) => {
			const current = prev[bookId] ?? { security: false, design: false };
			return { ...prev, [bookId]: { ...current, [phase]: checked } };
		});
	}

	let noteInput: HTMLInputElement | undefined;
	let confirmInput: HTMLButtonElement | undefined;

	const rows = () => queue()?.items ?? [];
	const pendingTotal = () => queue()?.total ?? 0;
	const windowView = () => adminQueueWindow(queue() ?? { total: 0, offset: 0, limit: ADMIN_QUEUE_PAGE_SIZE });

	/** Loads one page for the active view; an emptied last page falls back to the previous one. */
	async function loadQueue(target: number, mode: AdminViewMode = view()) {
		setLoading(true);
		setError(null);
		try {
			const query =
				mode === 'published'
					? { published: true, page: target, pageSize: ADMIN_QUEUE_PAGE_SIZE }
					: { review: 'pending' as const, page: target, pageSize: ADMIN_QUEUE_PAGE_SIZE };
			const result = await fetchAdminQueue(query);
			if (result.items.length === 0 && target > 1) {
				await loadQueue(target - 1, mode);
				return;
			}
			setQueue(result);
			setPage(windowView().page);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : LOAD_ERROR);
		} finally {
			setLoading(false);
		}
	}

	function switchView(next: AdminViewMode) {
		if (view() === next) return;
		disarm();
		setView(next);
		setPage(1);
		void loadQueue(1, next);
	}

	function disarm() {
		setArmed(null);
		setNote('');
		setPublishOnApprove(false);
	}

	function arm(book: AdminQueueBook, mode: ArmedRow['mode']) {
		if (busyId() === book.id) return;
		setError(null);
		setNote('');
		setPublishOnApprove(false);
		setArmed({ id: book.id, mode });
		queueMicrotask(() => {
			if (mode === 'reject' || mode === 'unpublish') {
				noteInput?.focus();
				return;
			}
			confirmInput?.focus();
		});
	}

	async function executeUnpublish(book: AdminQueueBook) {
		if (busyId() !== null) return;

		const trimmedNote = note().trim();
		setBusyId(book.id);
		setError(null);

		try {
			await unpublishAdminBook(book.id, trimmedNote || undefined);
			setAnnouncement(`«${book.title}» despublicado del catálogo público.`);
			disarm();
			await loadQueue(page(), view());
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : UNPUBLISH_ERROR);
		} finally {
			setBusyId(null);
		}
	}

	async function decide(book: AdminQueueBook, decision: 'approved' | 'rejected') {
		if (busyId() !== null) return;

		const publish = decision === 'approved' && publishOnApprove();
		const trimmedNote = note().trim();

		setBusyId(book.id);
		setError(null);

		try {
			await submitAdminReview(book.id, {
				decision,
				...(trimmedNote ? { note: trimmedNote } : {}),
				...(decision === 'approved' ? { publish } : {}),
			});

			setAnnouncement(
				decision === 'approved'
					? `«${book.title}» ${publish ? 'aprobado y publicado' : 'aprobado'}.`
					: `«${book.title}» rechazado.`,
			);
			disarm();
			await loadQueue(page());
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : DECISION_ERROR);
		} finally {
			setBusyId(null);
		}
	}

	async function handleSignOut() {
		if (signingOut()) return;
		setSigningOut(true);
		try {
			await signOutCleanly();
		} finally {
			window.location.assign('/');
		}
	}

	onMount(() => {
		void loadQueue(1);
	});

	// `Escape` disarms the row under review, exactly like the book modals.
	onMount(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || !armed()) return;
			event.preventDefault();
			disarm();
		};

		document.addEventListener('keydown', onKeyDown);
		onCleanup(() => document.removeEventListener('keydown', onKeyDown));
	});

	const avatarInitial = () => {
		const trimmed = props.userLabel.trim();
		return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : '·';
	};

	return (
		<>
			<header class="admin-top">
				<div class="admin-top-inner">
					<span class="admin-brand">
						<span class="sello" aria-hidden="true">
							熒
						</span>
						Ignit <span class="brand-divider" aria-hidden="true">·</span> Panel de administración
					</span>

					<div class="admin-top-actions">
						<span class="pending-badge" title={view() === 'published' ? 'Libros publicados' : 'PDFs pendientes de revisión'}>
							<span class="pending-count">{pendingTotal()}</span>
							<span class="pending-label">{view() === 'published' ? 'publicados' : 'pendientes'}</span>
						</span>
						<div class="user-pill">
							<span class="user-avatar" aria-hidden="true">
								{avatarInitial()}
							</span>
							<span class="user-name" title={props.userLabel}>
								{props.userLabel}
							</span>
							<button
								class="btn-ghost"
								type="button"
								disabled={signingOut()}
								onClick={() => void handleSignOut()}
							>
								{signingOut() ? 'Saliendo…' : 'Salir'}
							</button>
						</div>
					</div>
				</div>
			</header>

			<main class="admin-shell" id="main-content">
				<div class="sr-only" aria-live="polite">
					{announcement()}
				</div>

				<div class="admin-head">
					<p class="admin-eyebrow">Gestión de catálogo y revisión</p>
					<h1 class="admin-title">
						{view() === 'published' ? 'Catálogo publicado' : 'Cola de revisión'}
					</h1>
					<p class="admin-sub">
						{view() === 'published'
							? 'Controlá los libros visibles al público, revisá sus métricas básicas y despublicá al instante si una editorial o titular solicita el retiro.'
							: 'Cada PDF subido por la comunidad llega acá antes de publicarse. Revisá el archivo, aceptalo o rechazalo con una nota.'}
					</p>
					<div class="admin-tabs" role="tablist" aria-label="Vistas de administración">
						<button
							type="button"
							role="tab"
							class="admin-tab"
							aria-selected={view() === 'pending'}
							data-active={String(view() === 'pending')}
							onClick={() => switchView('pending')}
						>
							Cola pendiente
						</button>
						<button
							type="button"
							role="tab"
							class="admin-tab"
							aria-selected={view() === 'published'}
							data-active={String(view() === 'published')}
							onClick={() => switchView('published')}
						>
							Catálogo publicado y métricas
						</button>
					</div>
					<Show when={view() === 'pending'}>
						<StyleReferenceSection />
					</Show>
				</div>

				<Show when={error()}>
					<p class="admin-error" role="alert">
						{error()}
					</p>
				</Show>

				<Show when={loading() && rows().length === 0}>
					<p class="admin-loading" aria-live="polite">
						Cargando la cola…
					</p>
				</Show>

				<Show when={!loading() && rows().length === 0}>
					<section class="empty-state">
						<p class="empty-title">
							{view() === 'published'
								? 'No hay libros publicados en el catálogo'
								: 'No hay PDFs pendientes de revisión'}
						</p>
						<p class="empty-note">
							{view() === 'published'
								? 'Cuando apruebes y publiques un libro desde la cola, va a aparecer acá con sus métricas y botón de retiro inmediato.'
								: 'Todo lo subido por la comunidad ya fue revisado.'}
						</p>
						<a class="btn-secondary" href="/biblioteca">
							Volver a la biblioteca
						</a>
					</section>
				</Show>

				<Show when={rows().length > 0}>
					<ul class="queue-list">
						<For each={rows()}>
							{(book) => {
								const verdict = adminAiVerdict(book);
								const isArmed = () => armed()?.id === book.id;
								const mode = () => (isArmed() ? armed()!.mode : null);
								const isBusy = () => busyId() === book.id;

								return (
									<li class="queue-row" data-armed={String(isArmed())}>
										<div class="queue-main">
											<h2 class="row-title">{book.title}</h2>
											<p class="row-meta">
												<span class="row-author">{book.author}</span>
												<span class="dot" aria-hidden="true">·</span>
												<span>{adminKindLabel(book.kind)}</span>
												<span class="dot" aria-hidden="true">·</span>
												<span class="row-owner" title="Autor del aporte">
													{book.ownerEmail ?? 'sin email'}
												</span>
											</p>
											<p class="row-stats">
												<span>{formatAdminFileSize(book.fileSize)}</span>
												<span class="dot" aria-hidden="true">·</span>
												<span>
													{book.filePages !== null && book.filePages > 0
														? `${book.filePages} páginas`
														: 'sin conteo de páginas'}
												</span>
												<span class="dot" aria-hidden="true">·</span>
												<span>subido {formatAdminRelativeTime(book.createdAt)}</span>
											</p>

											<Show when={book.publisher || book.license || book.isbn}>
												<p class="row-editorial">
													<Show when={book.publisher}>
														<span>Editorial: {book.publisher}</span>
													</Show>
													<Show when={book.isbn}>
														<span>ISBN: {book.isbn}</span>
													</Show>
													<Show when={book.license}>
														<span>Licencia: {book.license}</span>
													</Show>
												</p>
											</Show>

											<div class="row-metrics" aria-label="Métricas del libro">
												<span class="metric-pill">
													Lecturas iniciadas: <strong>{book.readsStartedCount ?? 0}</strong>
												</span>
												<span class="metric-pill">
													Descargas offline: <strong>{book.offlineDownloadsCount ?? 0}</strong>
												</span>
												<span class="metric-pill">
													Clics CTA: <strong>{book.ctaClicksCount ?? 0}</strong>
												</span>
											</div>

											<Show when={view() === 'pending'}>
												<div class="row-ai" data-tone={verdict.tone}>
													<span class="ai-label">{verdict.label}</span>
													<Show when={verdict.qualityLabel}>
														<span class="ai-quality">{verdict.qualityLabel}</span>
													</Show>
													<Show when={verdict.notes}>
														<span class="ai-notes">{verdict.notes}</span>
													</Show>
												</div>

												<div class="row-phases">
													<section class="phase-card" aria-label="Fase 1: Seguridad">
														<div class="phase-head">
															<span class="phase-title">Fase 1 · Seguridad</span>
															<label class="phase-check">
																<input
																	type="checkbox"
																	checked={getPhases(book.id).security}
																	onChange={(event) => togglePhase(book.id, 'security', event.currentTarget.checked)}
																/>
																<span>{getPhases(book.id).security ? 'Aprobada' : 'Marcar aprobada'}</span>
															</label>
														</div>
														<button
															class="pipeline-toggle"
															type="button"
															aria-expanded={pipelineId() === book.id}
															onClick={() => setPipelineId(pipelineId() === book.id ? null : book.id)}
														>
															{pipelineId() === book.id ? 'Ocultar firewall' : 'Ver firewall'}
														</button>
														<FirewallPipeline bookId={book.id} open={pipelineId() === book.id} />
													</section>

													<section class="phase-card" aria-label="Fase 2: Diseño y contenido">
														<div class="phase-head">
															<span class="phase-title">Fase 2 · Diseño y preview</span>
															<label class="phase-check">
																<input
																	type="checkbox"
																	checked={getPhases(book.id).design}
																	onChange={(event) => togglePhase(book.id, 'design', event.currentTarget.checked)}
																/>
																<span>{getPhases(book.id).design ? 'Aprobado' : 'Marcar aprobado'}</span>
															</label>
														</div>
														<button
															class="pipeline-toggle"
															type="button"
															aria-expanded={clutterId() === book.id}
															onClick={() => setClutterId(clutterId() === book.id ? null : book.id)}
														>
															{clutterId() === book.id ? 'Ocultar diseño y preview' : 'Ver diseño, preview y suciedad'}
														</button>
														<BookClutterPanel bookId={book.id} open={clutterId() === book.id} />
													</section>
												</div>
											</Show>
										</div>

										<div class="row-actions">
											<a class="btn-secondary" href={`/lecturas/${book.id}`} target="_blank" rel="noreferrer">
												{view() === 'published' ? 'Abrir lector' : 'Ver PDF'}
											</a>

											<Show when={view() === 'published'}>
												<Show when={!isArmed()}>
													<button
														class="btn-reject"
														type="button"
														disabled={isBusy()}
														onClick={() => arm(book, 'unpublish')}
													>
														Despublicar
													</button>
												</Show>
												<Show when={mode() === 'unpublish'}>
													<div class="arm-panel" role="group" aria-label={`Confirmar retiro inmediato de «${book.title}»`}>
														<label class="arm-note">
															<span class="sr-only">Motivo del retiro</span>
															<input
																ref={(element) => {
																	noteInput = element;
																}}
																type="text"
																value={note()}
																placeholder="Motivo (ej. pedido de editorial)"
																maxLength={280}
																onInput={(event) => setNote(event.currentTarget.value)}
															/>
														</label>
														<button
															class="btn-reject"
															type="button"
															disabled={isBusy()}
															onClick={() => void executeUnpublish(book)}
														>
															{isBusy() ? 'Despublicando…' : 'Confirmar despublicación'}
														</button>
														<button class="btn-ghost" type="button" disabled={isBusy()} onClick={disarm}>
															Cancelar
														</button>
													</div>
												</Show>
											</Show>

											<Show when={view() === 'pending' && !isArmed()}>
												<button
													class="btn-approve"
													type="button"
													disabled={isBusy() || !getPhases(book.id).security || !getPhases(book.id).design}
													title={
														!getPhases(book.id).security || !getPhases(book.id).design
															? 'Aprobá Fase 1 (Seguridad) y Fase 2 (Diseño) para aceptar'
															: 'Aceptar libro'
													}
													onClick={() => arm(book, 'approve')}
												>
													Aceptar
												</button>
												<button
													class="btn-reject"
													type="button"
													disabled={isBusy()}
													onClick={() => arm(book, 'reject')}
												>
													Rechazar
												</button>
											</Show>

											<Show when={mode() === 'approve'}>
												<div class="arm-panel" role="group" aria-label={`Confirmar aprobación de «${book.title}»`}>
													<label class="arm-check">
														<input
															type="checkbox"
															checked={publishOnApprove()}
															onChange={(event) => setPublishOnApprove(event.currentTarget.checked)}
														/>
														<span>publicar al aprobar</span>
													</label>
													<button
														ref={(element) => {
															confirmInput = element;
														}}
														class="btn-approve"
														type="button"
														disabled={isBusy()}
														onClick={() => void decide(book, 'approved')}
													>
														{isBusy() ? 'Guardando…' : 'Confirmar aprobación'}
													</button>
													<button class="btn-ghost" type="button" disabled={isBusy()} onClick={disarm}>
														Cancelar
													</button>
												</div>
											</Show>

											<Show when={mode() === 'reject'}>
												<div class="arm-panel" role="group" aria-label={`Confirmar rechazo de «${book.title}»`}>
													<label class="arm-note">
														<span class="sr-only">Nota de rechazo</span>
														<input
															ref={(element) => {
																noteInput = element;
															}}
															type="text"
															value={note()}
															placeholder="Nota (opcional)"
															maxLength={280}
															onInput={(event) => setNote(event.currentTarget.value)}
														/>
													</label>
													<button
														class="btn-reject"
														type="button"
														disabled={isBusy()}
														onClick={() => void decide(book, 'rejected')}
													>
														{isBusy() ? 'Guardando…' : 'Confirmar rechazo'}
													</button>
													<button class="btn-ghost" type="button" disabled={isBusy()} onClick={disarm}>
														Cancelar
													</button>
												</div>
											</Show>
										</div>
									</li>
								);
							}}
						</For>
					</ul>

					<nav class="queue-pager" aria-label="Paginación de la cola">
						<button
							class="btn-ghost"
							type="button"
							disabled={!windowView().hasPrev || loading()}
							onClick={() => void loadQueue(windowView().page - 1)}
						>
							← Anterior
						</button>
						<span class="pager-label">
							{windowView().rangeLabel} · página {windowView().page} de {windowView().pageCount}
						</span>
						<button
							class="btn-ghost"
							type="button"
							disabled={!windowView().hasNext || loading()}
							onClick={() => void loadQueue(windowView().page + 1)}
						>
							Siguiente →
						</button>
					</nav>
				</Show>
			</main>
		</>
	);
}
