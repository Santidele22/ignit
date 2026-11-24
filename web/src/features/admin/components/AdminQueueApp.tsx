import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { signOutCleanly } from '../../auth/api/authActions';
import { FirewallPipeline } from './FirewallPipeline';
import { StyleReferenceSection } from './StyleReferenceSection';
import { ADMIN_QUEUE_PAGE_SIZE, fetchAdminQueue, submitAdminReview } from '../lib/admin-api';
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

type ArmedRow = { id: number; mode: 'approve' | 'reject' };

const LOAD_ERROR = 'No se pudo cargar la cola de revisión.';
const DECISION_ERROR = 'No se pudo registrar la decisión.';

export default function AdminQueueApp(props: AdminQueueAppProps) {
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

	let noteInput: HTMLInputElement | undefined;
	let confirmInput: HTMLButtonElement | undefined;

	const rows = () => queue()?.items ?? [];
	const pendingTotal = () => queue()?.total ?? 0;
	const windowView = () => adminQueueWindow(queue() ?? { total: 0, offset: 0, limit: ADMIN_QUEUE_PAGE_SIZE });

	/** Loads one page; an emptied last page falls back to the previous one. */
	async function loadQueue(target: number) {
		setLoading(true);
		setError(null);
		try {
			const result = await fetchAdminQueue({ page: target, pageSize: ADMIN_QUEUE_PAGE_SIZE });
			if (result.items.length === 0 && target > 1) {
				await loadQueue(target - 1);
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
			if (mode === 'reject') {
				noteInput?.focus();
				return;
			}
			confirmInput?.focus();
		});
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
						<span class="pending-badge" title="PDFs pendientes de revisión">
							<span class="pending-count">{pendingTotal()}</span>
							<span class="pending-label">pendientes</span>
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
					<p class="admin-eyebrow">Revisión de PDFs</p>
					<h1 class="admin-title">Cola de revisión</h1>
					<p class="admin-sub">
						Cada PDF subido por la comunidad llega acá antes de publicarse. Revisá el archivo, aceptalo o
						rechazalo con una nota.
					</p>
					<StyleReferenceSection />
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
						<p class="empty-title">No hay PDFs pendientes de revisión</p>
						<p class="empty-note">Todo lo subido por la comunidad ya fue revisado.</p>
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

											<div class="row-ai" data-tone={verdict.tone}>
												<span class="ai-label">{verdict.label}</span>
												<Show when={verdict.qualityLabel}>
													<span class="ai-quality">{verdict.qualityLabel}</span>
												</Show>
												<Show when={verdict.notes}>
													<span class="ai-notes">{verdict.notes}</span>
												</Show>
											</div>

											<button
												class="pipeline-toggle"
												type="button"
												aria-expanded={pipelineId() === book.id}
												onClick={() => setPipelineId(pipelineId() === book.id ? null : book.id)}
											>
												{pipelineId() === book.id ? 'Ocultar pipeline' : 'Pipeline de seguridad'}
											</button>
											<FirewallPipeline bookId={book.id} open={pipelineId() === book.id} />
										</div>

										<div class="row-actions">
											<a class="btn-secondary" href={`/lecturas/${book.id}`} target="_blank" rel="noreferrer">
												Ver PDF
											</a>

											<Show when={!isArmed()}>
												<button
													class="btn-approve"
													type="button"
													disabled={isBusy()}
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
