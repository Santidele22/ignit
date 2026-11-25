import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { pdfNameHints } from '../lib/upload-hints';
import {
	OPEN_LICENSE_OPTIONS,
	OPEN_LICENSE_REQUIRED_MESSAGE,
	isOpenLicense,
} from '../../../entities/book/open-licenses';
import { BOOK_KIND_OPTIONS, type BookKind } from '../../../entities/book/types';
import CoverPickerModal from '../../book/components/CoverPickerModal';
import {
	createBookReturning,
	searchBookCovers,
	suggestBookMetadata,
	uploadBookFile,
	type CoverSearchCandidate,
} from '../../book/api/books-admin';
import type { AdminBookRow } from '../../book/api/books-admin';
import { bookFormToBody } from '../../book/bookForm';
import { formatSizeKb, kindFromValue, validateBookUpload } from '../lib/sala';

/**
 * `+ Subir libro` modal (S7).
 *
 * Accessible dialog (`role="dialog"`, `aria-modal`, focus trap on Tab/Shift+Tab,
 * `Escape`, backdrop click, focus restoration and auto-focus on the title)
 * that creates the book through the real `POST /books` and, when a PDF or EPUB
 * was picked, uploads it through `POST /books/:id/file` in the same flow.
 */
export type UploadOutcome = 'created' | 'file-failed';

export interface UploadBookModalProps {
	open: boolean;
	onClose: () => void;
	/** The book was created: refresh lists, go to `Mis aportes` and announce. */
	onCreated: (created: AdminBookRow, outcome: UploadOutcome) => void;
}

const FOCUSABLE = 'button, input, select, textarea, a[href]';

export default function UploadBookModal(props: UploadBookModalProps) {
	const [title, setTitle] = createSignal('');
	const [author, setAuthor] = createSignal('');
	const [titleManual, setTitleManual] = createSignal(false);
	const [authorManual, setAuthorManual] = createSignal(false);
	const [kind, setKind] = createSignal<BookKind>('no_tecnico');
	const [description, setDescription] = createSignal('');
	const [descriptionManual, setDescriptionManual] = createSignal(false);
	const [coverUrl, setCoverUrl] = createSignal('');
	const [coverResults, setCoverResults] = createSignal<CoverSearchCandidate[]>([]);
	const [coverModalOpen, setCoverModalOpen] = createSignal(false);
	const [coverQuery, setCoverQuery] = createSignal('');
	const [searchingCovers, setSearchingCovers] = createSignal(false);
	const [prefillStatus, setPrefillStatus] = createSignal('');
	const [prefillStage, setPrefillStage] = createSignal<'idle' | 'metadata' | 'cover'>('idle');
	const [published, setPublished] = createSignal(false);
	const [publisher, setPublisher] = createSignal('');
	const [translator, setTranslator] = createSignal('');
	const [illustrator, setIllustrator] = createSignal('');
	const [isbn, setIsbn] = createSignal('');
	const [license, setLicense] = createSignal('');
	const [licenseManual, setLicenseManual] = createSignal(false);
	const [licenseStatus, setLicenseStatus] = createSignal<'idle' | 'open' | 'copyrighted' | 'unknown'>('idle');
	const [licenseReason, setLicenseReason] = createSignal('');
	const [ctaLabel, setCtaLabel] = createSignal('');
	const [ctaUrl, setCtaUrl] = createSignal('');
	const [file, setFile] = createSignal<File | null>(null);
	const [createdRow, setCreatedRow] = createSignal<AdminBookRow | null>(null);
	const [submittedTitle, setSubmittedTitle] = createSignal<string | null>(null);
	const [submittedPublic, setSubmittedPublic] = createSignal(false);
	const [submitting, setSubmitting] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	let backdrop: HTMLDivElement | undefined;
	let titleInput: HTMLInputElement | undefined;
	let fileInput: HTMLInputElement | undefined;
	let lastTrigger: HTMLElement | null = null;
	let wasOpen = false;

	function resetForm() {
		setTitle('');
		setAuthor('');
		setTitleManual(false);
		setAuthorManual(false);
		setKind('no_tecnico');
		setDescription('');
		setDescriptionManual(false);
		setCoverUrl('');
		setCoverResults([]);
		setCoverModalOpen(false);
		setCoverQuery('');
		setSearchingCovers(false);
		setPrefillStatus('');
		setPrefillStage('idle');
		setPublished(false);
		setPublisher('');
		setTranslator('');
		setIllustrator('');
		setIsbn('');
		setLicense('');
		setLicenseManual(false);
		setLicenseStatus('idle');
		setLicenseReason('');
		setCtaLabel('');
		setCtaUrl('');
		setFile(null);
		setCreatedRow(null);
		setSubmittedTitle(null);
		setSubmittedPublic(false);
		setError(null);
		if (fileInput) fileInput.value = '';
	}

	function close() {
		if (submitting()) return;
		if (coverModalOpen()) {
			setCoverModalOpen(false);
			return;
		}
		props.onClose();
	}

	function pickFile(next: File | null) {
		if (!next) {
			setFile(null);
			setError(null);
			return;
		}
		const problem = validateBookUpload(next);
		if (problem) {
			setFile(null);
			setError(problem);
			if (fileInput) fileInput.value = '';
			return;
		}
		setFile(next);
		setError(null);
		setLicenseStatus('idle');
		setLicenseReason('');
		if (!licenseManual()) setLicense('');

		// Prefill from the filename (e.g. `Título – Autor.pdf`) in real time
		// whenever the user changes the selected book file, without overwriting
		// fields the user edited manually.
		const hints = pdfNameHints(next.name);
		if (!titleManual()) setTitle(hints.title ?? '');
		if (!authorManual()) setAuthor(hints.author ?? '');
		void runSmartPrefill(next.name);
	}

	async function runSmartPrefill(filename: string) {
		setPrefillStage('metadata');
		setPrefillStatus('Rellenando metadatos y verificando licencia con IA…');
		try {
			const suggested = await suggestBookMetadata(filename);
			if (suggested.title && !titleManual()) setTitle(suggested.title);
			if (suggested.author && !authorManual()) setAuthor(suggested.author);
			if (suggested.description && !descriptionManual()) setDescription(suggested.description);

			if (suggested.licenseStatus === 'copyrighted') {
				setLicenseStatus('copyrighted');
				setLicenseReason(
					suggested.licenseReason?.trim() ||
						'Obra con derechos de autor vigentes: solo puede guardarse en tu biblioteca personal.',
				);
				setPublished(false);
				setLicense('');
			} else if (suggested.licenseStatus === 'open' && suggested.license && isOpenLicense(suggested.license)) {
				setLicenseStatus('open');
				setLicenseReason(suggested.licenseReason?.trim() || 'Licencia abierta detectada por IA.');
				if (!licenseManual()) setLicense(suggested.license);
			} else {
				setLicenseStatus('unknown');
				setLicenseReason(suggested.licenseReason?.trim() || '');
			}

			const queryTitle = (suggested.title ?? title()).trim();
			const queryAuthor = (suggested.author ?? author()).trim();
			if (queryTitle) {
				setPrefillStage('cover');
				setPrefillStatus('Buscando portada…');
				await handleSearchCovers(queryTitle, queryAuthor, suggested.coverQueries ?? []);
			}
		} catch {
			// Fail-open: deterministic filename hints already populated the form.
		} finally {
			setPrefillStatus('');
			setPrefillStage('idle');
		}
	}

	async function handleSearchCovers(
		customTitle = title().trim(),
		customAuthor = author().trim(),
		altQueries: string[] = [],
	) {
		if (!customTitle || searchingCovers()) return;
		setSearchingCovers(true);
		try {
			const results = await searchBookCovers(customTitle, customAuthor, altQueries);
			setCoverResults(results);
			if (!coverUrl().trim() && results[0]?.coverUrl) {
				setCoverUrl(results[0].coverUrl);
			}
		} catch {
			setCoverResults([]);
		} finally {
			setSearchingCovers(false);
		}
	}

	function openCoverModal() {
		const currentTitle = title().trim();
		const currentAuthor = author().trim();
		if (!coverQuery().trim() && currentTitle) {
			setCoverQuery(currentAuthor ? `${currentTitle} ${currentAuthor}` : currentTitle);
		}
		setCoverModalOpen(true);
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (submitting()) return;

		const cleanTitle = title().trim();
		const cleanAuthor = author().trim();
		if (!cleanTitle || !cleanAuthor) {
			setError('El libro necesita un título y un autor.');
			return;
		}

		const selected = file();
		if (selected) {
			const problem = validateBookUpload(selected);
			if (problem) {
				setError(problem);
				return;
			}
		}

		const cleanCtaUrl = ctaUrl().trim();
		if (cleanCtaUrl && !/^https?:\/\//i.test(cleanCtaUrl)) {
			setError('El enlace externo debe comenzar con http:// o https://.');
			return;
		}

		if (licenseStatus() === 'copyrighted' && published()) {
			setPublished(false);
			setError(
				licenseReason() ||
					'Esta obra tiene derechos de autor vigentes y solo puede guardarse en tu biblioteca personal.',
			);
			return;
		}

		if (published() && !isOpenLicense(license())) {
			setError(OPEN_LICENSE_REQUIRED_MESSAGE);
			return;
		}

		setError(null);
		setSubmitting(true);

		const body = bookFormToBody({
			title: cleanTitle,
			author: cleanAuthor,
			description: description().trim() || 'Libro cargado en Ignit.',
			status: 'queued',
			kind: kind(),
			review: '',
			published: published(),
			coverUrl: coverUrl().trim() || undefined,
			publisher: publisher(),
			translator: translator(),
			illustrator: illustrator(),
			isbn: isbn(),
			license: license(),
			ctaLabel: ctaLabel(),
			ctaUrl: cleanCtaUrl,
		});

		let created = createdRow();
		if (!created) {
			try {
				created = await createBookReturning(body);
				setCreatedRow(created);
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : 'No se pudo crear el libro.');
				setSubmitting(false);
				return;
			}
		}

		if (!selected) {
			const titleCopy = created.title;
			const wasPublic = published();
			resetForm();
			setSubmittedTitle(titleCopy);
			setSubmittedPublic(wasPublic);
			setSubmitting(false);
			props.onCreated(created, 'created');
			return;
		}

		try {
			await uploadBookFile(created.id, selected);
			const titleCopy = created.title;
			const wasPublic = published();
			resetForm();
			setSubmittedTitle(titleCopy);
			setSubmittedPublic(wasPublic);
			props.onCreated(created, 'created');
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : 'No se pudo subir el archivo.';
			setError(
				`«${created.title}» se creó, pero el archivo no se pudo subir: ${message} Podés reintentar el envío acá o desde Editar.`,
			);
			props.onCreated(created, 'file-failed');
		} finally {
			setSubmitting(false);
		}
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			close();
			return;
		}
		if (event.key !== 'Tab' || !backdrop) return;

		const focusables = [...backdrop.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
			(element) => !element.hasAttribute('disabled') && element.tabIndex !== -1,
		);
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		if (!first || !last) return;

		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	createEffect(() => {
		const open = props.open;
		if (open === wasOpen) return;
		wasOpen = open;

		if (open) {
			lastTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			queueMicrotask(() => titleInput?.focus());
			return;
		}

		resetForm();
		const trigger = lastTrigger;
		lastTrigger = null;
		queueMicrotask(() => trigger?.focus?.());
	});

	createEffect(() => {
		if (!props.open) return;
		const onWindowKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				close();
			}
		};
		window.addEventListener('keydown', onWindowKeyDown);
		onCleanup(() => window.removeEventListener('keydown', onWindowKeyDown));
	});

	return (
		<div
			ref={backdrop}
			class="modal-back"
			data-open={String(props.open)}
			role="dialog"
			aria-modal="true"
			aria-labelledby="uploadTitle"
			tabIndex={-1}
			onKeyDown={handleKeyDown}
			onClick={(event) => {
				if (event.target === event.currentTarget) close();
			}}
		>
			<div class="modal-box">
				<div class="modal-head">
					<span id="uploadTitle">Subir libro a la biblioteca</span>
					<button class="btn-ghost modal-close" type="button" disabled={submitting()} onClick={() => close()}>
						Cerrar ✕
					</button>
				</div>
				<Show
					when={!submittedTitle()}
					fallback={
						<div class="modal-body">
							<p class="pipe-notice" role="status">
								<Show
									when={submittedPublic()}
									fallback={
										<>
											<strong>¡Listo!</strong> «{submittedTitle()}» fue guardado en tu{' '}
											<b>biblioteca privada</b>. Ya podés abrirlo y leerlo en Modo Vigilia.
										</>
									}
								>
									<strong>¡Listo!</strong> «{submittedTitle()}» fue enviado a revisión administrativa para el
									catálogo público (licencias abiertas). Mientras tanto ya podés leerlo en tu biblioteca privada.
								</Show>
							</p>
							<div class="modal-foot">
								<button
									type="button"
									class="btn-primary"
									onClick={() => {
										resetForm();
										props.onClose();
									}}
								>
									Entendido
								</button>
							</div>
						</div>
					}
				>
					<form
						class="upload-form-wrap"
						data-prefill={String(prefillStatus().length > 0)}
						onSubmit={(event) => void handleSubmit(event)}
					>
					<div
						class="modal-body"
						data-prefill={String(prefillStatus().length > 0)}
					>
						<div
							class="drop-pdf"
							data-has-file={String(file() !== null)}
							onDragOver={(event) => event.preventDefault()}
							onDrop={(event) => {
								event.preventDefault();
								pickFile(event.dataTransfer?.files?.[0] ?? null);
							}}
							onClick={(event) => {
								if (event.target !== fileInput) fileInput?.click();
							}}
						>
							<Show
								when={file()}
								fallback={<span>PDF o EPUB · hasta 50 MB · entra en tu biblioteca</span>}
							>
								{(selected) => (
									<span>
										{selected().name} · {formatSizeKb(Math.max(1, Math.round(selected().size / 1024)))}
									</span>
								)}
							</Show>
							<input
								ref={fileInput}
								id="upFile"
								type="file"
								accept="application/pdf,.pdf,application/epub+zip,.epub"
								disabled={submitting()}
								onChange={(event) => pickFile(event.currentTarget.files?.[0] ?? null)}
							/>
						</div>

						<div class="field">
							<label for="upTitle">Título del libro</label>
							<input
								ref={titleInput}
								id="upTitle"
								type="text"
								required
								placeholder="Ej. Ficciones"
								value={title()}
								disabled={submitting()}
								onInput={(event) => {
									const next = event.currentTarget.value;
									setTitleManual(next.trim().length > 0);
									setTitle(next);
								}}
							/>
						</div>

						<div class="modal-grid">
							<div class="field">
								<label for="upAuthor">Autor</label>
								<input
									id="upAuthor"
									type="text"
									required
									placeholder="Jorge Luis Borges"
									value={author()}
									disabled={submitting()}
									onInput={(event) => {
										const next = event.currentTarget.value;
										setAuthorManual(next.trim().length > 0);
										setAuthor(next);
									}}
								/>
							</div>
							<div class="field">
								<label for="upCat">Categoría</label>
								<select
									id="upCat"
									value={kind()}
									disabled={submitting()}
									onChange={(event) => setKind(kindFromValue(event.currentTarget.value))}
								>
									{BOOK_KIND_OPTIONS.map((option) => (
										<option value={option.value} selected={kind() === option.value}>
											{option.label}
										</option>
									))}
								</select>
							</div>
						</div>

						<div class="field">
							<label for="upDesc">Descripción breve</label>
							<textarea
								id="upDesc"
								rows={2}
								placeholder="De qué trata el libro…"
								value={description()}
								disabled={submitting()}
								onInput={(event) => {
									const next = event.currentTarget.value;
									setDescriptionManual(next.trim().length > 0);
									setDescription(next);
								}}
							/>
						</div>

						<div class="field">
							<div class="cover-field-head">
								<label>Portada del libro</label>
								<button
									type="button"
									class="btn-sec cover-search-btn"
									disabled={submitting() || (!title().trim() && coverResults().length === 0)}
									onClick={() => openCoverModal()}
								>
									{searchingCovers()
										? 'Buscando en Google…'
										: coverResults().length > 0
											? `Elegir portada (${coverResults().length})`
											: 'Buscar portada en Google'}
								</button>
							</div>
							<div class="cover-preview-row">
								<Show
									when={coverUrl().trim()}
									fallback={<span class="cover-preview-empty">Sin portada seleccionada (usará tapa editorial)</span>}
								>
									<img class="cover-preview-thumb" src={coverUrl()} alt="Portada seleccionada" />
									<div class="cover-preview-info">
										<span class="cover-preview-label">Portada real seleccionada</span>
										<button
											type="button"
											class="btn-ghost cover-clear-btn"
											onClick={() => setCoverUrl('')}
										>
											Quitar
										</button>
									</div>
								</Show>
							</div>
						</div>

						<details class="ficha-details">
							<summary>Ficha editorial y enlace externo (opcional)</summary>
							<div class="ficha-details-grid">
								<div class="modal-grid">
									<div class="field">
										<label for="upPublisher">Editorial</label>
										<input
											id="upPublisher"
											type="text"
											placeholder="Ej. Editorial Sur"
											value={publisher()}
											disabled={submitting()}
											onInput={(event) => setPublisher(event.currentTarget.value)}
										/>
									</div>
									<div class="field">
										<label for="upIsbn">ISBN</label>
										<input
											id="upIsbn"
											type="text"
											placeholder="978-987-…"
											value={isbn()}
											disabled={submitting()}
											onInput={(event) => setIsbn(event.currentTarget.value)}
										/>
									</div>
								</div>
								<div class="modal-grid">
									<div class="field">
										<label for="upTranslator">Traductor</label>
										<input
											id="upTranslator"
											type="text"
											placeholder="Opcional"
											value={translator()}
											disabled={submitting()}
											onInput={(event) => setTranslator(event.currentTarget.value)}
										/>
									</div>
									<div class="field">
										<label for="upIllustrator">Ilustrador</label>
										<input
											id="upIllustrator"
											type="text"
											placeholder="Opcional"
											value={illustrator()}
											disabled={submitting()}
											onInput={(event) => setIllustrator(event.currentTarget.value)}
										/>
									</div>
								</div>
								<div class="modal-grid">
									<div class="field">
										<label for="upCtaLabel">Botón externo (texto)</label>
										<input
											id="upCtaLabel"
											type="text"
											placeholder="Ej. Comprar libro físico"
											value={ctaLabel()}
											disabled={submitting()}
											onInput={(event) => setCtaLabel(event.currentTarget.value)}
										/>
									</div>
									<div class="field">
										<label for="upCtaUrl">Enlace externo (URL)</label>
										<input
											id="upCtaUrl"
											type="url"
											placeholder="https://tienda-editorial.com/libro"
											value={ctaUrl()}
											disabled={submitting()}
											onInput={(event) => setCtaUrl(event.currentTarget.value)}
										/>
									</div>
								</div>
							</div>
						</details>

						<Show when={licenseStatus() === 'copyrighted'}>
							<p class="pipe-notice" role="status">
								<strong>Solo biblioteca personal:</strong> {licenseReason()} No puede postularse al catálogo
								público, pero podés guardarlo en tu biblioteca privada para leerlo en Modo Vigilia.
							</p>
						</Show>

						<Show when={licenseStatus() === 'open' && licenseReason()}>
							<p class="pipe-notice" role="status">
								<strong>Licencia abierta detectada:</strong> {licenseReason()}
							</p>
						</Show>

						<label class="field checkbox-field">
							<input
								id="upPublish"
								type="checkbox"
								checked={licenseStatus() !== 'copyrighted' && published()}
								disabled={submitting() || licenseStatus() === 'copyrighted'}
								onChange={(event) => setPublished(event.currentTarget.checked)}
							/>
							<span class="checkbox-label">
								{licenseStatus() === 'copyrighted'
									? 'Catálogo público deshabilitado (solo biblioteca personal)'
									: 'Solicitar publicación en el catálogo público (solo licencias abiertas)'}
							</span>
						</label>

						<Show when={licenseStatus() !== 'copyrighted'}>
							<div class="field">
								<label for="upLicense">
									Licencia abierta {published() ? '(obligatoria para el catálogo público)' : '(opcional)'}
								</label>
								<select
									id="upLicense"
									value={license()}
									required={published()}
									disabled={submitting()}
									onChange={(event) => {
										setLicenseManual(true);
										setLicense(event.currentTarget.value);
									}}
								>
									<option value="">Sin especificar (solo biblioteca privada)</option>
									{OPEN_LICENSE_OPTIONS.map((option) => (
										<option value={option} selected={license() === option}>
											{option}
										</option>
									))}
									<Show
										when={
											license() &&
											!(OPEN_LICENSE_OPTIONS as readonly string[]).includes(license())
										}
									>
										<option value={license()} selected>
											{license()}
										</option>
									</Show>
								</select>
							</div>
						</Show>

						<p class="pipe-notice">
							<Show
								when={published()}
								fallback={
									<>
										Tu archivo queda en tu <b>biblioteca privada</b> para leerlo en Modo Vigilia (solo vos podés
										verlo). El catálogo público admite únicamente obras de <b>dominio público o licencias
										abiertas</b>.
									</>
								}
							>
								Tu libro queda en <b>revisión administrativa</b> antes de publicarse en el catálogo público:
								verificamos seguridad, formato en Vigilia y que cuente con una <b>licencia abierta o dominio
								público</b>.
							</Show>
						</p>

						<Show when={error()}>
							<p class="form-error" role="alert">
								{error()}
							</p>
						</Show>
					</div>
					<div class="modal-foot">
						<button class="btn-sec" type="button" disabled={submitting()} onClick={() => close()}>
							Cancelar
						</button>
						<button class="btn-primary" type="submit" disabled={submitting()}>
							{submitting()
								? 'Enviando…'
								: published()
									? 'Enviar a revisión pública'
									: 'Guardar en mi biblioteca'}
						</button>
					</div>
					<Show when={prefillStatus()}>
						<div class="prefill-overlay" role="status" aria-live="polite">
							<div class="prefill-stage">
								<div class="book-scene" aria-hidden="true">
									<div class="book-glow" />
									<div class="book-flip">
										<span class="book-cover" />
										<span class="book-stack stack-left" />
										<span class="book-stack stack-right" />
										<span class="book-page page-left" />
										<span class="book-page page-right" />
										<span class="book-leaf leaf-1" />
										<span class="book-leaf leaf-2" />
										<span class="book-leaf leaf-3" />
										<span class="book-spine" />
									</div>
									<div class="book-shadow" />
								</div>

								<div class="prefill-copy">
									<span class="prefill-kicker">
										<span class="prefill-dot" aria-hidden="true" />
										Lectura asistida · IA
									</span>
									<p class="prefill-label">{prefillStatus()}</p>
									<Show when={file()}>
										{(selected) => <span class="prefill-file">{selected().name}</span>}
									</Show>
								</div>

								<div class="prefill-steps" aria-hidden="true">
									<span
										class="prefill-step"
										data-state={prefillStage() === 'metadata' ? 'active' : 'done'}
									>
										01 · Metadatos
									</span>
									<span class="prefill-step-sep" />
									<span
										class="prefill-step"
										data-state={prefillStage() === 'cover' ? 'active' : 'pending'}
									>
										02 · Portada
									</span>
								</div>
							</div>
						</div>
					</Show>
				</form>
				</Show>
			</div>

			<CoverPickerModal
				open={coverModalOpen()}
				selectedUrl={coverUrl()}
				defaultQuery={coverQuery()}
				onResults={(results) => {
					setCoverResults(results);
					if (!coverUrl().trim() && results[0]?.coverUrl) {
						setCoverUrl(results[0].coverUrl);
					}
				}}
				onClose={() => setCoverModalOpen(false)}
				onSelect={(url) => setCoverUrl(url)}
			/>
		</div>
	);
}
