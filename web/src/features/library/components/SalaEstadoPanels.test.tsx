// @vitest-environment happy-dom
/**
 * Component pins for `SalaEstadoPanels` (S2), the two mounted rooms of the
 * shelf («Estudio y Disciplina» / «Despeje Literario») introduced by artboard
 * `design/biblioteca-tecnico-literatura/05-biblioteca-estudio-despeje.html`.
 *
 * The counts are the real ones the app passes in (technical kinds vs.
 * literature kinds of the merged sala books); the panel only renders them and
 * reports the toggle intent, so the tests observe exactly that contract.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import SalaEstadoPanels from './SalaEstadoPanels';

afterEach(() => cleanup());

function mount(props: {
	active?: 'estudio' | 'despeje' | null;
	counts?: { estudio: number; despeje: number };
	onSelect?: (estado: 'estudio' | 'despeje' | null) => void;
}) {
	return render(() => (
		<SalaEstadoPanels
			counts={props.counts ?? { estudio: 7, despeje: 6 }}
			active={props.active ?? null}
			onSelect={props.onSelect ?? (() => {})}
		/>
	));
}

describe('SalaEstadoPanels (S2)', () => {
	it('mounts the two rooms with their real tomo counts', () => {
		const { container } = mount({});
		const cards = container.querySelectorAll<HTMLButtonElement>('.state-card');

		expect(cards).toHaveLength(2);
		expect(cards[0]!.dataset.state).toBe('estudio');
		expect(cards[0]!.textContent).toContain('Estado 01 · Rigor profesional');
		expect(cards[0]!.textContent).toContain('Estudio y Disciplina');
		expect(cards[0]!.textContent).toContain('7');
		expect(cards[0]!.textContent).toContain('tomos');

		expect(cards[1]!.dataset.state).toBe('despeje');
		expect(cards[1]!.textContent).toContain('Estado 02 · Pausa y vigilia');
		expect(cards[1]!.textContent).toContain('Despeje Literario');
		expect(cards[1]!.textContent).toContain('6');
	});

	it('keeps both panels unpressed by default and singularises a single tomo', () => {
		const { container } = mount({ counts: { estudio: 1, despeje: 0 } });
		const cards = container.querySelectorAll<HTMLButtonElement>('.state-card');

		expect(cards[0]!.getAttribute('aria-pressed')).toBe('false');
		expect(cards[1]!.getAttribute('aria-pressed')).toBe('false');
		expect(cards[0]!.textContent).toContain('1');
		expect(cards[0]!.textContent).toContain('tomo');
		expect(cards[0]!.textContent).not.toContain('tomos');
	});

	it('marks only the active room as pressed', () => {
		const { container } = mount({ active: 'despeje' });
		const cards = container.querySelectorAll<HTMLButtonElement>('.state-card');

		expect(cards[0]!.getAttribute('aria-pressed')).toBe('false');
		expect(cards[1]!.getAttribute('aria-pressed')).toBe('true');
	});

	it('selects a room and clears the filter when the active room is pressed again', () => {
		const onSelect = vi.fn();
		const first = mount({ onSelect });
		fireEvent.click(first.container.querySelectorAll<HTMLButtonElement>('.state-card')[1]!);
		expect(onSelect).toHaveBeenLastCalledWith('despeje');
		cleanup();

		const second = mount({ active: 'despeje', onSelect });
		fireEvent.click(second.container.querySelectorAll<HTMLButtonElement>('.state-card')[1]!);
		expect(onSelect).toHaveBeenLastCalledWith(null);
	});
});
