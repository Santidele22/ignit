import { For, Show } from 'solid-js';
import type { AporteRow, SalaBook } from '../lib/sala';

/**
 * `Mis aportes` pipeline (S6): each owned book as an `.aporte-row` with the
 * 4-step standby → en curso → tested → catálogo pills derived from the existing
 * API fields (`published`, `hasFile`), its status tag, the `/lecturas/:id`
 * preview and the discrete `Editar` action.
 */
export interface AportesListProps {
	rows: AporteRow[];
	onEdit: (book: SalaBook) => void;
	onOpenUpload: () => void;
}

const STEP_LABELS = ['1 · Standby', '2 · En curso', '3 · Tested', '4 · Catálogo'] as const;

function stepState(step: number, stageIndex: number): string | undefined {
	if (step < stageIndex) return 'done';
	if (step === stageIndex) return 'now';
	return undefined;
}

export default function AportesList(props: AportesListProps) {
	return (
		<Show
			when={props.rows.length > 0}
			fallback={
				<div class="aportes-list">
					<div class="empty-box">
						Todavía no enviaste ningún libro. <br />
						Subí un PDF y seguí acá su recorrido: standby → en curso → tested → catálogo.
						<div class="empty-box-action">
							<button class="btn-sec" type="button" onClick={() => props.onOpenUpload()}>
								+ Subir primer aporte
							</button>
						</div>
					</div>
				</div>
			}
		>
			<div class="aportes-list">
				<For each={props.rows}>
					{(row) => (
						<div class="aporte-row">
							<div>
								<div class="aporte-title">{row.book.title}</div>
								<div class="aporte-meta">{row.metaLine}</div>
								<p class="aporte-note">{row.note}</p>
							</div>
							<div class="steps-mini" aria-label={`Estado: ${row.statusTag}`}>
								<For each={STEP_LABELS}>
									{(label, index) => {
										const state = stepState(index() + 1, row.stageIndex);
										return (
											<span class="st-pill" data-state={state}>
												{label}
											</span>
										);
									}}
								</For>
							</div>
							<div class="aporte-actions">
								<span class="aporte-state">{row.statusTag}</span>
								<Show when={row.previewHref}>
									{(href) => (
										<a class="btn-sec" href={href()}>
											Ver preview
										</a>
									)}
								</Show>
								<button class="btn-sec" type="button" onClick={() => props.onEdit(row.book)}>
									Editar
								</button>
							</div>
						</div>
					)}
				</For>
			</div>
		</Show>
	);
}
