import { Show, createEffect, onCleanup } from 'solid-js';
import type { Book } from '../../../entities/book/types';
import { recordBookMetric, safeExternalUrl } from '../../book/api/books';

export interface BookFichaModalProps {
	book: Book | null;
	onClose: () => void;
}

/**
 * Editorial sheet ("Ficha del libro") modal for `/biblioteca`.
 * Displays publisher, author, translator, illustrator, ISBN, license,
 * synopsis, and the optional external CTA button (tracked via `cta_click`).
 */
export default function BookFichaModal(props: BookFichaModalProps) {
	let lastTrigger: HTMLElement | null = null;
	let wasOpen = false;

	createEffect(() => {
		const open = props.book !== null;
		if (open === wasOpen) return;
		wasOpen = open;

		if (open) {
			lastTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			return;
		}
		const trigger = lastTrigger;
		lastTrigger = null;
		queueMicrotask(() => trigger?.focus?.());
	});

	createEffect(() => {
		if (!props.book) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				props.onClose();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		onCleanup(() => window.removeEventListener('keydown', onKeyDown));
	});

	const hasEditorialMeta = () => {
		const b = props.book;
		if (!b) return false;
		return Boolean(b.publisher || b.translator || b.illustrator || b.isbn || b.license);
	};

	return (
		<div
			class="modal-back"
			data-open={String(props.book !== null)}
			role="dialog"
			aria-modal="true"
			aria-labelledby="fichaTitle"
			tabIndex={-1}
			onClick={(event) => {
				if (event.target === event.currentTarget) props.onClose();
			}}
		>
			<Show when={props.book}>
				{(book) => (
					<div class="modal-box ficha-modal-box">
						<div class="modal-head">
							<span id="fichaTitle">Ficha del libro</span>
							<button class="btn-ghost modal-close" type="button" onClick={() => props.onClose()}>
								Cerrar ✕
							</button>
						</div>

						<div class="modal-body ficha-body">
							<div class="ficha-header">
								<h2 class="ficha-book-title">{book().title}</h2>
								<p class="ficha-book-author">{book().author}</p>
							</div>

							<Show when={book().description}>
								<p class="ficha-desc">{book().description}</p>
							</Show>

							<Show when={book().review}>
								<blockquote class="ficha-review">{book().review}</blockquote>
							</Show>

							<dl class="ficha-dl">
								<div class="ficha-row">
									<dt>Autor</dt>
									<dd>{book().author}</dd>
								</div>
								<Show when={book().publisher}>
									<div class="ficha-row">
										<dt>Editorial</dt>
										<dd>{book().publisher}</dd>
									</div>
								</Show>
								<Show when={book().translator}>
									<div class="ficha-row">
										<dt>Traductor</dt>
										<dd>{book().translator}</dd>
									</div>
								</Show>
								<Show when={book().illustrator}>
									<div class="ficha-row">
										<dt>Ilustrador</dt>
										<dd>{book().illustrator}</dd>
									</div>
								</Show>
								<Show when={book().isbn}>
									<div class="ficha-row">
										<dt>ISBN</dt>
										<dd class="ficha-mono">{book().isbn}</dd>
									</div>
								</Show>
								<Show when={book().license}>
									<div class="ficha-row">
										<dt>Licencia</dt>
										<dd>{book().license}</dd>
									</div>
								</Show>
							</dl>

							<Show when={!hasEditorialMeta()}>
								<p class="ficha-empty-note">
									Sin datos editoriales adicionales cargados todavía.
								</p>
							</Show>

							<Show when={safeExternalUrl(book().ctaUrl)}>
								{(href) => (
									<div class="ficha-cta-wrap">
										<a
											class="btn-primary ficha-cta-btn"
											href={href()}
											target="_blank"
											rel="noopener noreferrer"
											onClick={() => recordBookMetric(book().id, 'cta_click')}
										>
											{book().ctaLabel?.trim() || 'Apoyar / Conseguir libro físico'} ↗
										</a>
									</div>
								)}
							</Show>
						</div>

						<div class="modal-foot">
							<button class="btn-sec" type="button" onClick={() => props.onClose()}>
								Cerrar
							</button>
							<a class="btn-primary" href={`/lecturas/${book().id}`}>
								Abrir en Vigilia
							</a>
						</div>
					</div>
				)}
			</Show>
		</div>
	);
}
