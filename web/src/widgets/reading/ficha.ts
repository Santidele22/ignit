import { recordBookMetric } from '../../features/book/api/books';
import { bookId } from './state';

/**
 * Wires the Vigilia "Ficha del libro" popover toggle (`#fichaBtn` / `#fichaDeck`)
 * and outbound external CTA click tracking (`[data-cta-track]`).
 */
export function initFicha(): void {
	const btn = document.getElementById('fichaBtn');
	const deck = document.getElementById('fichaDeck');
	const closeBtn = document.getElementById('fichaClose');

	const setOpen = (open: boolean) => {
		if (!deck || !btn) return;
		deck.hidden = !open;
		btn.setAttribute('aria-expanded', String(open));
	};

	if (btn && deck) {
		btn.addEventListener('click', () => {
			setOpen(Boolean(deck.hidden));
		});
		closeBtn?.addEventListener('click', () => setOpen(false));
		document.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && !deck.hidden) {
				setOpen(false);
			}
		});
	}

	const ctaLinks = document.querySelectorAll<HTMLAnchorElement>('[data-cta-track="1"]');
	for (const link of ctaLinks) {
		link.addEventListener('click', () => {
			recordBookMetric(bookId, 'cta_click');
		});
	}
}
