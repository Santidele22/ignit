import { For } from 'solid-js';
import { SALA_ESTADOS, type SalaEstado } from '../lib/sala';

/**
 * The two mounted rooms of the shelf (S2, artboard
 * `design/biblioteca-tecnico-literatura/05-biblioteca-estudio-despeje.html`):
 * «Estudio y Disciplina» and «Despeje Literario» with their real tomo counts.
 *
 * Both panels start unpressed — the shelf keeps showing every book — and each
 * one is a toggle: pressing the active room clears the lens again. The counts
 * and the kind mapping come from `lib/sala.ts` (single `BookKind` taxonomy),
 * so a book is never invented or double-counted here.
 */
export interface SalaEstadoPanelsProps {
	counts: Record<SalaEstado, number>;
	/** Active room lens, `null` when the shelf shows every room. */
	active: SalaEstado | null;
	/** Requested lens: the room, or `null` to clear it. */
	onSelect: (estado: SalaEstado | null) => void;
}

export default function SalaEstadoPanels(props: SalaEstadoPanelsProps) {
	return (
		<section class="state-threshold" aria-label="Estantes de la biblioteca">
			<For each={SALA_ESTADOS}>
				{(estado) => (
					<button
						class="state-card"
						type="button"
						data-state={estado.id}
						aria-pressed={props.active === estado.id}
						onClick={() => props.onSelect(props.active === estado.id ? null : estado.id)}
					>
						<span class="state-copy">
							<span class="state-kicker">{estado.kicker}</span>
							<span class="state-title">{estado.title}</span>
							<span class="state-sub">{estado.subtitle}</span>
						</span>
						<span class="state-count">
							{props.counts[estado.id]}
							<small>{props.counts[estado.id] === 1 ? 'tomo' : 'tomos'}</small>
						</span>
					</button>
				)}
			</For>
		</section>
	);
}
