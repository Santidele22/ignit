import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { pdfNameHints } from '../lib/upload-hints';
import type { BookKind } from '../../../entities/book/types';
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
import { formatSizeKb, kindFromValue, validatePdfUpload } from '../lib/sala';

/**
 * `+ Subir libro` modal (S7).
 *
 * Accessible dialog (`role="dialog"`, `aria-modal`, focus trap on Tab/Shift+Tab,
 * `Escape`, backdrop click, focus restoration and auto-focus on the title)
 * that creates the book through the real `POST /books` and, when a PDF was
 * picked, uploads it through `POST /books/:id/file` in the same flow.
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
	const [published, setPublished] = createSignal(false);
	const [file, setFile] = createSignal<File | null>(null);
	const [createdRow, setCreatedRow] = createSignal<AdminBookRow | null>(null);
	const [submittedTitle, setSubmittedTitle] = createSignal<string | null>(null);
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
		setPublished(false);
		setFile(null);
		setCreatedRow(null);
		setSubmittedTitle(null);
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
		const problem = validatePdfUpload(next);
		if (problem) {
			setFile(null);
			setError(problem);
			if (fileInput) fileInput.value = '';
			return;
		}
		setFile(next);
		setError(null);

		// Prefill from the filename (e.g. `Título – Autor.pdf`) in real time
		// whenever the user changes the selected PDF, without overwriting fields
		// the user edited manually.
		const hints = pdfNameHints(next.name);
		if (!titleManual()) setTitle(hints.title ?? '');
		if (!authorManual()) setAuthor(hints.author ?? '');
		void runSmartPrefill(next.name);
	}

	async function runSmartPrefill(filename: string) {
		setPrefillStatus('Rellenando título, autor y descripción con IA…');
		try {
			const suggested = await suggestBookMetadata(filename);
			if (suggested.title && !titleManual()) setTitle(suggested.title);
			if (suggested.author && !authorManual()) setAuthor(suggested.author);
			if (suggested.description && !descriptionManual()) setDescription(suggested.description);
			const queryTitle = (suggested.title ?? title()).trim();
			const queryAuthor = (suggested.author ?? author()).trim();
			if (queryTitle) {
				setPrefillStatus('Buscando portada en Google…');
				await handleSearchCovers(queryTitle, queryAuthor);
			}
		} catch {
			// Fail-open: deterministic filename hints already populated the form.
		} finally {
			setPrefillStatus('');
		}
	}

	async function handleSearchCovers(
		customTitle = title().trim(),
		customAuthor = author().trim(),
	) {
		if (!customTitle || searchingCovers()) return;
		setSearchingCovers(true);
		try {
			const results = await searchBookCovers(customTitle, customAuthor);
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
			const problem = validatePdfUpload(selected);
			if (problem) {
				setError(problem);
				return;
			}
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
			resetForm();
			setSubmittedTitle(titleCopy);
			setSubmitting(false);
			props.onCreated(created, 'created');
			return;
		}

		try {
			await uploadBookFile(created.id, selected);
			const titleCopy = created.title;
			resetForm();
			setSubmittedTitle(titleCopy);
			props.onCreated(created, 'created');
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : 'No se pudo subir el PDF.';
			setError(
				`«${created.title}» se creó, pero el PDF no se pudo subir: ${message} Podés reintentar el envío acá o desde Editar.`,
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
								<strong>¡Listo!</strong> «{submittedTitle()}» fue enviado al pipeline de revisión.
								En breve vas a recibir una notificación cuando pase las fases de seguridad y diseño.
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
					<form onSubmit={(event) => void handleSubmit(event)}>
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
								fallback={<span>PDF · hasta 50 MB · entra en tu biblioteca</span>}
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
								accept="application/pdf,.pdf"
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
									<option value="no_tecnico">No técnico</option>
									<option value="tecnico">Técnico</option>
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

						<label class="field checkbox-field">
							<input
								id="upPublish"
								type="checkbox"
								checked={published()}
								disabled={submitting()}
								onChange={(event) => setPublished(event.currentTarget.checked)}
							/>
							<span class="checkbox-label">Publicar en el catálogo público</span>
						</label>

						<p class="pipe-notice">
							Al subirlo queda en <b>standby</b> dentro de tu biblioteca, sin publicar. Cuando el PDF está
							limpio pasa a <b>tested</b> (lectura en Vigilia) y recién ahí lo publicás en el{' '}
							<b>catálogo público</b> desde Editar.
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
							{submitting() ? 'Enviando…' : published() ? 'Publicar libro' : 'Enviar a standby'}
						</button>
					</div>
				</form>
				<Show when={prefillStatus()}>
					<div class="prefill-overlay" role="status" aria-live="polite">
						<div class="book-flip" aria-hidden="true">
							<span class="book-page page-left" />
							<span class="book-page page-right" />
							<span class="book-leaf" />
							<span class="book-spine" />
						</div>
						<span class="prefill-label">{prefillStatus()}</span>
					</div>
				</Show>
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
