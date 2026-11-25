// @vitest-environment happy-dom
/**
 * Component pins for `BookTomoCard` (S2/S3) after the artboard
 * `05-biblioteca-estudio-despeje.html` restyle: the numbered ficha keeps the
 * existing real actions (open reader when the file exists, ficha/edit modals,
 * IndexedDB download/remove) while gaining the domain chip, the pages + size
 * metadata line and the LEER / AÑADIR / QUITAR layout.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { mergeSalaBooks, type SalaBook } from '../lib/sala';
import BookTomoCard from './BookTomoCard';

afterEach(() => cleanup());

function makeSalaBook(overrides: Partial<SalaBook> = {}): SalaBook {
	const [base] = mergeSalaBooks({
		ownedBooks: [],
		catalogBooks: [
			{
				id: 4,
				title: 'Sistemas operativos',
				author: 'Tanenbaum',
				description: 'Un manual de referencia.',
				status: 'reading',
				statusLabel: 'Leyendo',
				kind: 'tecnico',
				published: true,
				hasFile: true,
			},
		],
		offlineRecords: [],
		localSnapshots: new Map(),
	});
	return { ...base!, pdfPages: 214, sizeKb: 566, ...overrides };
}

function mount(book: SalaBook, props: { busy?: boolean; appOffline?: boolean; onOpenFicha?: boolean } = {}) {
	const onToggleOffline = vi.fn();
	const onOpenFicha = vi.fn();
	const onEdit = vi.fn();
	const view = render(() => (
		<BookTomoCard
			book={book}
			coverPrefix="test"
			appOffline={props.appOffline ?? false}
			busy={props.busy ?? false}
			onToggleOffline={onToggleOffline}
			onEdit={onEdit}
			{...(props.onOpenFicha === false ? {} : { onOpenFicha })}
		/>
	));
	return { ...view, onToggleOffline, onOpenFicha, onEdit };
}

describe('BookTomoCard ficha (S2)', () => {
	it('renders the numbered ficha with its domain chip and pages/size metadata', () => {
		const { container } = mount(makeSalaBook());

		expect(container.querySelector('.tomo-idx')?.textContent).toBe('01');
		expect(container.querySelector('.tomo-tag')?.textContent).toBe('Técnico');
		expect(container.querySelector('.tomo-datos')?.textContent).toBe('214 p · 566 KB');
		expect(container.querySelector('.tomo-autor')?.textContent).toBe('Tanenbaum');
		expect(container.querySelector('.tomo-prog')?.textContent).toContain('Sin comenzar');
	});

	it('exposes LEER to the real reader when the book has a file', () => {
		const { container, getAllByText } = mount(makeSalaBook());

		const leer = container.querySelector<HTMLAnchorElement>('.btn-leer');
		expect(leer?.getAttribute('href')).toBe('/lecturas/4');
		expect(leer?.textContent).toBe('Leer');
		expect(getAllByText('Leer')).toHaveLength(1);
	});

	it('hides LEER when the book has no PDF and keeps the ficha affordance', () => {
		const withFile = mount(makeSalaBook());
		expect(withFile.container.querySelector('.btn-leer')).not.toBeNull();
		cleanup();

		const withoutFile = mount(makeSalaBook({ hasFile: false }), { onOpenFicha: false });
		expect(withoutFile.container.querySelector('.btn-leer')).toBeNull();
	});

	it('offers AÑADIR as the primary action and toggles the real offline copy', () => {
		const book = makeSalaBook();
		const { container, onToggleOffline } = mount(book);
		const action = container.querySelector<HTMLButtonElement>('.btn-dl')!;

		expect(action.textContent).toBe('Añadir');
		expect(action.getAttribute('data-tone')).toBe('anadir');
		expect(action.getAttribute('aria-pressed')).toBe('false');
		expect(action.disabled).toBe(false);

		fireEvent.click(action);
		expect(onToggleOffline).toHaveBeenCalledWith(book);
	});

	it('switches to QUITAR when the book is already offline', () => {
		const book = makeSalaBook({ isOffline: true });
		const { container } = mount(book);
		const action = container.querySelector<HTMLButtonElement>('.btn-dl')!;

		expect(action.textContent).toBe('Quitar');
		expect(action.getAttribute('data-tone')).toBe('quitar');
		expect(action.getAttribute('aria-pressed')).toBe('true');
	});

	it('keeps the existing busy and missing-file gates of the download action', () => {
		const busy = mount(makeSalaBook(), { busy: true });
		const busyAction = busy.container.querySelector<HTMLButtonElement>('.btn-dl')!;
		expect(busyAction.textContent).toBe('Guardando…');
		expect(busyAction.disabled).toBe(true);
		cleanup();

		const noFile = mount(makeSalaBook({ hasFile: false }), { onOpenFicha: false });
		const noFileAction = noFile.container.querySelector<HTMLButtonElement>('.btn-dl')!;
		expect(noFileAction.disabled).toBe(true);
		expect(noFileAction.getAttribute('title')).toBe('Sin PDF disponible');
	});

	it('keeps the ficha and edit affordances of the owner', () => {
		const book = makeSalaBook({ isOwner: true });
		const { container, onOpenFicha, onEdit } = mount(book);

		const buttons = [...container.querySelectorAll<HTMLButtonElement>('.btn-edit-mini')];
		expect(buttons.map((button) => button.textContent)).toEqual(['Ficha', 'Editar']);

		fireEvent.click(buttons[0]!);
		fireEvent.click(buttons[1]!);
		expect(onOpenFicha).toHaveBeenCalledWith(book);
		expect(onEdit).toHaveBeenCalledWith(book);
	});
});
