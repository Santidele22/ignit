// @vitest-environment happy-dom
/**
 * Component pins for `CoverPickerModal` (S1–S4), the shared Google Books cover
 * dialog used by `UploadBookModal` and `EditBookModal`.
 *
 * Each test below is a regression pin for an accepted contract or for a finding
 * the independent verifier reproduced against the first implementation (search
 * loop, card click no longer closing, `onResults` auto-select). The API module
 * is mocked so the tests observe the dialog contract only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import CoverPickerModal from './CoverPickerModal';
import { searchBookCovers, type CoverSearchCandidate } from '../api/books-admin';

vi.mock('../api/books-admin', () => ({
	searchBookCovers: vi.fn(),
}));

const searchBookCoversMock = vi.mocked(searchBookCovers);

const SEED_QUERY = 'Cien años de soledad';

/** Queries an element the dialog must have rendered; throws instead of returning null. */
function mustQuery<T extends Element>(container: HTMLElement, selector: string): T {
	const match = container.querySelector<T>(selector);
	if (!match) throw new Error(`CoverPickerModal did not render «${selector}»`);
	return match;
}

const CANDIDATES: CoverSearchCandidate[] = [
	{ title: 'Cien años de soledad', authors: ['Gabriel García Márquez'], coverUrl: 'https://books.example/cas.jpg' },
	{ title: 'Pedro Páramo', authors: ['Juan Rulfo'], coverUrl: 'https://books.example/pp.jpg' },
];

const EMPTY_NOTICE = 'No se encontraron portadas para esa búsqueda. Probá con otro título.';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

/**
 * Mounts the dialog with the parent-side wiring both real modals use: `onClose`
 * collapses the picker signal (the component itself never owns `open`).
 */
function mount(options: { open?: boolean; selectedUrl?: string; defaultQuery?: string } = {}) {
	const [open, setOpen] = createSignal(options.open ?? true);
	const onSelect = vi.fn();
	const onResults = vi.fn();
	const onClose = vi.fn(() => setOpen(false));

	const view = render(() => (
		<CoverPickerModal
			open={open()}
			selectedUrl={options.selectedUrl ?? ''}
			defaultQuery={options.defaultQuery ?? SEED_QUERY}
			onResults={onResults}
			onClose={onClose}
			onSelect={onSelect}
		/>
	));

	return {
		...view,
		onClose,
		onResults,
		onSelect,
		input: () => mustQuery<HTMLInputElement>(view.container, '.cover-modal-search input'),
		cards: () => [...view.container.querySelectorAll<HTMLButtonElement>('.cover-modal-card')],
		backdrop: () => mustQuery<HTMLElement>(view.container, '.cover-modal-backdrop'),
		text: () => view.container.textContent ?? '',
	};
}

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement {
	const match = [...container.querySelectorAll('button')].find(
		(button) => (button.textContent ?? '').trim() === label,
	);
	if (!match) throw new Error(`No button labelled «${label}» in the dialog`);
	return match as HTMLButtonElement;
}

beforeEach(() => {
	searchBookCoversMock.mockReset();
});

afterEach(() => {
	cleanup();
});

describe('CoverPickerModal', () => {
	it('S2: runs exactly one seeded search per open and keeps a typed query through the settle', async () => {
		// First search is delayed so the test can type while it is in flight and
		// then let it settle. Any later search stays pending: that keeps a
		// tracked-`searching()` re-entry finite and observable as an extra call.
		const first = deferred<CoverSearchCandidate[]>();
		searchBookCoversMock.mockImplementation(() =>
			searchBookCoversMock.mock.calls.length === 1 ? first.promise : new Promise(() => {}),
		);

		const view = mount();

		expect(searchBookCoversMock).toHaveBeenCalledTimes(1);
		expect(searchBookCoversMock).toHaveBeenCalledWith(SEED_QUERY, '');
		expect(view.input().value).toBe(SEED_QUERY);

		fireEvent.input(view.input(), { target: { value: 'Pedro Páramo' } });
		expect(view.input().value).toBe('Pedro Páramo');

		first.resolve(CANDIDATES);
		await waitFor(() => expect(view.cards()).toHaveLength(CANDIDATES.length));

		// The old loop (effect tracking `searching()`) re-seeded the box and fired a
		// second search on every settle: 1601 effect runs / 1200 searches in 150 ms.
		expect(searchBookCoversMock).toHaveBeenCalledTimes(1);
		expect(view.input().value).toBe('Pedro Páramo');
	});

	it('S3: one card click selects that cover and closes, and reports results to the parent', async () => {
		searchBookCoversMock.mockResolvedValue(CANDIDATES);

		const view = mount();
		await waitFor(() => expect(view.cards()).toHaveLength(CANDIDATES.length));
		expect(view.onResults).toHaveBeenCalledWith(CANDIDATES);
		expect(view.onClose).not.toHaveBeenCalled();

		fireEvent.click(view.cards()[1]);

		expect(view.onSelect).toHaveBeenCalledTimes(1);
		expect(view.onSelect).toHaveBeenCalledWith('https://books.example/pp.jpg');
		expect(view.onClose).toHaveBeenCalledTimes(1);
	});

	it('S1: «Usar tapa editorial» clears the selection with onSelect("") and closes', async () => {
		searchBookCoversMock.mockResolvedValue(CANDIDATES);

		const view = mount({ selectedUrl: 'https://books.example/cas.jpg' });
		await waitFor(() => expect(view.cards()).toHaveLength(CANDIDATES.length));

		fireEvent.click(buttonByText(view.container, 'Usar tapa editorial'));

		expect(view.onSelect).toHaveBeenCalledTimes(1);
		expect(view.onSelect).toHaveBeenCalledWith('');
		expect(view.onClose).toHaveBeenCalledTimes(1);
	});

	it('S1: a backdrop click closes only the picker layer', async () => {
		searchBookCoversMock.mockResolvedValue(CANDIDATES);

		const view = mount();
		await waitFor(() => expect(view.cards()).toHaveLength(CANDIDATES.length));

		fireEvent.click(view.backdrop());

		expect(view.onClose).toHaveBeenCalledTimes(1);
		expect(view.onSelect).not.toHaveBeenCalled();
	});

	it('S1: shows the empty-results notice copy', async () => {
		searchBookCoversMock.mockResolvedValue([]);

		const view = mount();

		await waitFor(() => expect(view.text()).toContain(EMPTY_NOTICE));
		expect(view.onResults).toHaveBeenCalledWith([]);
	});

	it('S1: shows the same notice copy when the search rejects', async () => {
		searchBookCoversMock.mockRejectedValue(new Error('cover-search unavailable'));

		const view = mount();

		await waitFor(() => expect(view.text()).toContain(EMPTY_NOTICE));
		expect(view.cards()).toHaveLength(0);
		expect(view.onResults).not.toHaveBeenCalled();
	});

	/**
	 * S4 limitation: the dialog owns no `Escape` handling on purpose. In the app,
	 * `Escape` bubbles to the parent modal, whose `close()` returns early while
	 * `coverModalOpen()` is true (`UploadBookModal.tsx` / `EditBookModal.tsx`, the
	 * `coverModalOpen()` guard inside `close()`), so the first `Escape` collapses
	 * only the picker layer. That parent guard is not observable from this
	 * component test because those two modals are outside this task's edit
	 * surface; this test pins the component side of the contract: it must not
	 * swallow the key and must not close the parent layer by itself.
	 */
	it('S4: leaves Escape to the parent modal layer instead of closing the picker itself', async () => {
		searchBookCoversMock.mockResolvedValue(CANDIDATES);

		const view = mount();
		await waitFor(() => expect(view.cards()).toHaveLength(CANDIDATES.length));

		const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		view.input().dispatchEvent(escape);

		expect(escape.defaultPrevented).toBe(false);
		expect(view.onClose).not.toHaveBeenCalled();
		expect(view.cards()).toHaveLength(CANDIDATES.length);
	});
});
