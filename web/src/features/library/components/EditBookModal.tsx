import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import type { Book } from '../../../entities/book/types';
import { deleteBook, updateBook, uploadBookFile } from '../../book/api/books-admin';
import {
	BOOK_KIND_OPTIONS,
	BOOK_STATUS_OPTIONS,
	bookFormToBody,
	bookToForm,
	validateBookForm,
	type BookFormState,
} from '../../book/bookForm';
import { formatSizeKb, kindFromValue, validatePdfUpload } from '../lib/sala';

/**
 * `Editar` modal for the user's own books (S7).
 *
 * Same accessible dialog contract as `UploadBookModal` (focus trap, `Escape`,
 * backdrop click, focus restoration). Saves metadata through `PATCH /books/:id`,
 * optionally attaches/replaces the PDF through `POST /books/:id/file`, and
 * deletes through `DELETE /books/:id` behind an inline two-step confirmation
 * (never `window.confirm`).
 */
export interface EditBookResult {
	message: string;
	/** `false` when the modal must stay open (a retry is still possible). */
	close: boolean;
}

export interface EditBookModalProps {
	book: Book | null;
	onClose: () => void;
	onSaved: (result: EditBookResult) => void;
	onDeleted: (result: EditBookResult) => void;
}

const FOCUSABLE = 'button, input, select, textarea, a[href]';

const EMPTY_FORM: BookFormState = {
	title: '',
	author: '',
	description: '',
	status: 'reading',
	kind: 'no_tecnico',
	review: '',
	published: false,
};

export default function EditBookModal(props: EditBookModalProps) {
	const [form, setForm] = createSignal<BookFormState>(EMPTY_FORM);
	const [pdfFile, setPdfFile] = createSignal<File | null>(null);
	const [deleteArmed, setDeleteArmed] = createSignal(false);
	const [saving, setSaving] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	let backdrop: HTMLDivElement | undefined;
	let titleInput: HTMLInputElement | undefined;
	let fileInput: HTMLInputElement | undefined;
	let lastTrigger: HTMLElement | null = null;
	let wasOpen = false;

	function update<K extends keyof BookFormState>(key: K, value: BookFormState[K]) {
		setForm((current) => ({ ...current, [key]: value }));
	}

	function clearPdf() {
		setPdfFile(null);
		if (fileInput) fileInput.value = '';
	}

	function close() {
		if (saving()) return;
		props.onClose();
	}

	function pickFile(next: File | null) {
		if (!next) {
			clearPdf();
			return;
		}
		const problem = validatePdfUpload(next);
		if (problem) {
			clearPdf();
			setError(problem);
			return;
		}
		setPdfFile(next);
		setError(null);
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		const current = props.book;
		if (!current || saving()) return;

		const problem = validateBookForm(form());
		if (problem) {
			setError(problem);
			return;
		}

		const selected = pdfFile();
		if (selected) {
			const fileProblem = validatePdfUpload(selected);
			if (fileProblem) {
				setError(fileProblem);
				return;
			}
		}

		setError(null);
		setSaving(true);

		try {
			await updateBook(current.id, bookFormToBody(form()));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'No se pudieron guardar los cambios.');
			setSaving(false);
			return;
		}

		if (!selected) {
			setSaving(false);
			props.onSaved({ message: `«${current.title}» actualizado.`, close: true });
			return;
		}

		try {
			await uploadBookFile(current.id, selected);
			clearPdf();
			props.onSaved({ message: `«${current.title}» actualizado y PDF cargado.`, close: true });
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : 'No se pudo subir el PDF.';
			setError(`Los datos se guardaron, pero el PDF no se pudo subir: ${message}`);
			props.onSaved({ message: `«${current.title}» actualizado. El PDF quedó pendiente.`, close: false });
		} finally {
			setSaving(false);
		}
	}

	async function handleDelete() {
		const current = props.book;
		if (!current || saving()) return;

		if (!deleteArmed()) {
			setDeleteArmed(true);
			setError(null);
			return;
		}

		setSaving(true);
		setError(null);
		try {
			await deleteBook(current.id);
			setDeleteArmed(false);
			props.onDeleted({ message: `«${current.title}» eliminado de tu biblioteca.`, close: true });
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'No se pudo eliminar el libro.');
			setDeleteArmed(false);
		} finally {
			setSaving(false);
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
		const current = props.book;

		if (current === null) {
			if (wasOpen) {
				wasOpen = false;
				clearPdf();
				setDeleteArmed(false);
				setError(null);
				const trigger = lastTrigger;
				lastTrigger = null;
				queueMicrotask(() => trigger?.focus?.());
			}
			return;
		}

		if (!wasOpen) {
			wasOpen = true;
			lastTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		}

		setForm(bookToForm(current));
		clearPdf();
		setDeleteArmed(false);
		setError(null);
		queueMicrotask(() => titleInput?.focus());
	});

	createEffect(() => {
		if (props.book === null) return;
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
			data-open={String(props.book !== null)}
			role="dialog"
			aria-modal="true"
			aria-labelledby="editTitle"
			tabIndex={-1}
			onKeyDown={handleKeyDown}
			onClick={(event) => {
				if (event.target === event.currentTarget) close();
			}}
		>
			<div class="modal-box">
				<div class="modal-head">
					<span id="editTitle">Editar libro</span>
					<button class="btn-ghost" type="button" disabled={saving()} onClick={() => close()}>
						Cerrar ✕
					</button>
				</div>
				<form onSubmit={(event) => void handleSubmit(event)}>
					<div class="modal-body">
						<div class="field">
							<label for="editBookTitle">Título</label>
							<input
								ref={titleInput}
								id="editBookTitle"
								type="text"
								required
								value={form().title}
								disabled={saving()}
								onInput={(event) => update('title', event.currentTarget.value)}
							/>
						</div>

						<div class="modal-grid">
							<div class="field">
								<label for="editBookAuthor">Autor</label>
								<input
									id="editBookAuthor"
									type="text"
									required
									value={form().author}
									disabled={saving()}
									onInput={(event) => update('author', event.currentTarget.value)}
								/>
							</div>
							<div class="field">
								<label for="editBookCat">Categoría</label>
								<select
									id="editBookCat"
									value={form().kind}
									disabled={saving()}
									onChange={(event) => update('kind', kindFromValue(event.currentTarget.value))}
								>
									{BOOK_KIND_OPTIONS.map((option) => (
										<option value={option.value} selected={form().kind === option.value}>
											{option.label}
										</option>
									))}
								</select>
							</div>
						</div>

						<div class="field">
							<label for="editBookStatus">Estado</label>
							<select
								id="editBookStatus"
								value={form().status}
								disabled={saving()}
								onChange={(event) => update('status', event.currentTarget.value)}
							>
								{BOOK_STATUS_OPTIONS.map((option) => (
									<option value={option.value} selected={form().status === option.value}>
										{option.label}
									</option>
								))}
							</select>
						</div>

						<div class="field">
							<label for="editBookDesc">Descripción</label>
							<textarea
								id="editBookDesc"
								rows={2}
								required
								value={form().description}
								disabled={saving()}
								onInput={(event) => update('description', event.currentTarget.value)}
							/>
						</div>

						<div class="field">
							<label for="editBookReview">Reseña (opcional)</label>
							<textarea
								id="editBookReview"
								rows={2}
								value={form().review}
								disabled={saving()}
								onInput={(event) => update('review', event.currentTarget.value)}
							/>
						</div>

						<label class="field" style={{ 'flex-direction': 'row', 'align-items': 'center', gap: '9px' }}>
							<input
								id="editBookPublished"
								type="checkbox"
								checked={form().published}
								disabled={saving()}
								onChange={(event) => update('published', event.currentTarget.checked)}
							/>
							<span style={{ 'letter-spacing': '0.1em', 'text-transform': 'uppercase', 'font-size': '9.5px' }}>
								Publicado en el catálogo
							</span>
						</label>

						<div
							class="drop-pdf"
							data-has-file={String(pdfFile() !== null)}
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
								when={pdfFile()}
								fallback={<span>PDF opcional · reemplaza el actual · hasta 50 MB</span>}
							>
								{(selected) => (
									<span>
										{selected().name} · {formatSizeKb(Math.max(1, Math.round(selected().size / 1024)))}
									</span>
								)}
							</Show>
							<input
								ref={fileInput}
								id="editBookFile"
								type="file"
								accept="application/pdf,.pdf"
								disabled={saving()}
								onChange={(event) => pickFile(event.currentTarget.files?.[0] ?? null)}
							/>
						</div>

						<Show when={error()}>
							<p class="form-error" role="alert">
								{error()}
							</p>
						</Show>
					</div>
					<div class="modal-foot">
						<Show
							when={deleteArmed()}
							fallback={
								<button
									class="btn-sec"
									type="button"
									disabled={saving()}
									onClick={() => void handleDelete()}
								>
									Eliminar libro
								</button>
							}
						>
							<button
								class="btn-danger"
								type="button"
								disabled={saving()}
								onClick={() => void handleDelete()}
							>
								Confirmar eliminación
							</button>
							<button
								class="btn-sec"
								type="button"
								disabled={saving()}
								onClick={() => setDeleteArmed(false)}
							>
								Cancelar eliminación
							</button>
						</Show>
						<span style={{ flex: '1' }} aria-hidden="true" />
						<button class="btn-sec" type="button" disabled={saving()} onClick={() => close()}>
							Cancelar
						</button>
						<button class="btn-primary" type="submit" disabled={saving()}>
							{saving() ? 'Guardando…' : 'Guardar cambios'}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
