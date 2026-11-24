import { For, Show, createEffect, createSignal, untrack } from 'solid-js';
import { searchBookCovers, type CoverSearchCandidate } from '../api/books-admin';

/**
 * Shared Google Books cover picker dialog (S7 library modals).
 *
 * Owned cover state lives in the parent form (`UploadBookModal`,
 * `EditBookModal`); this dialog only queries `/books/cover-search` and yields
 * the selected candidate back. It is a nested `role="dialog"` layer: clicking
 * its own backdrop or `Listo` closes just this layer, while `Escape` bubbles
 * to the underlying modal's handler, which waits for the picker to close
 * first (see the `coverOpen` guard in each parent modal).
 */
export interface CoverPickerModalProps {
	open: boolean;
	/** Current selected cover URL; highlights the matching result card. */
	selectedUrl: string;
	/** Query seed shown in the search box when the dialog opens empty. */
	defaultQuery: string;
	onResults?: (results: CoverSearchCandidate[]) => void;
	onClose: () => void;
	/** Selection with an empty url clears the cover (`Usar tapa editorial`). */
	onSelect: (url: string) => void;
}

export default function CoverPickerModal(props: CoverPickerModalProps) {
	const [query, setQuery] = createSignal('');
	const [results, setResults] = createSignal<CoverSearchCandidate[]>([]);
	const [searching, setSearching] = createSignal(false);

	// Re-seed the search box and auto-run the first query each time the dialog
	// opens, using the parent-supplied query text.
	createEffect(() => {
		if (!props.open) return;
		const seed = props.defaultQuery.trim();
		if (!seed) return;
		setQuery(seed);
		// `untrack`: `searching()` is read by `runSearch`'s overlap guard; tracking
		// it here would re-run this effect in a loop whenever a search settles.
		untrack(() => void runSearch(seed, ''));
	});

	async function runSearch(title: string, author = '') {
		if (!title.trim() || searching()) return;
		setSearching(true);
		try {
			const results = await searchBookCovers(title, author);
			setResults(results);
			untrack(() => props.onResults?.(results));
		} catch {
			setResults([]);
		} finally {
			setSearching(false);
		}
	}

	return (
		<Show when={props.open}>
			<div
				class="modal-backdrop cover-modal-backdrop"
				role="dialog"
				aria-modal="true"
				aria-label="Elegir portada en Google Books"
				onClick={(event) => {
					if (event.target === event.currentTarget) props.onClose();
				}}
			>
				<div class="modal-box cover-modal-box">
					<div class="modal-head">
						<span>Elegir portada de Google</span>
						<button class="btn-ghost modal-close" type="button" onClick={() => props.onClose()}>
							Cerrar ✕
						</button>
					</div>
					<div class="modal-body">
						<div class="cover-modal-search">
							<input
								type="text"
								placeholder="Buscar por título o autor…"
								value={query()}
								onInput={(event) => setQuery(event.currentTarget.value)}
								onKeyDown={(event) => {
									if (event.key === 'Enter') {
										event.preventDefault();
										void runSearch(query(), '');
									}
								}}
							/>
							<button
								type="button"
								class="btn-primary"
								disabled={searching() || !query().trim()}
								onClick={() => void runSearch(query(), '')}
							>
								{searching() ? 'Buscando…' : 'Buscar'}
							</button>
						</div>

						<Show when={searching()}>
							<p class="pipe-notice">Buscando portadas en Google Books…</p>
						</Show>

						<Show when={!searching() && results().length === 0}>
							<p class="pipe-notice">No se encontraron portadas para esa búsqueda. Probá con otro título.</p>
						</Show>

						<Show when={results().length > 0}>
							<div class="cover-modal-grid">
								<For each={results()}>
									{(item) => (
										<button
											type="button"
											class="cover-modal-card"
											data-selected={String(props.selectedUrl === item.coverUrl)}
											onClick={() => {
												// Baseline upload flow selected AND closed in one click.
												props.onSelect(item.coverUrl);
												props.onClose();
											}}
										>
											<img src={item.coverUrl} alt={item.title} loading="lazy" />
											<span class="cover-modal-title">{item.title}</span>
											<Show when={item.authors.length > 0}>
												<span class="cover-modal-author">{item.authors[0]}</span>
											</Show>
										</button>
									)}
								</For>
							</div>
						</Show>
					</div>
					<div class="modal-foot">
						<button
							type="button"
							class="btn-sec"
							onClick={() => {
								props.onSelect('');
								props.onClose();
							}}
						>
							Usar tapa editorial
						</button>
						<button type="button" class="btn-primary" onClick={() => props.onClose()}>
							Listo
						</button>
					</div>
				</div>
			</div>
		</Show>
	);
}
