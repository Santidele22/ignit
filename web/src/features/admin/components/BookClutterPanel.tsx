import { For, Show, createEffect, createSignal } from 'solid-js';
import {
	dropBookClutter,
	fetchBookChunks,
	fetchBookClutter,
	patchBookChunks,
	reextractBookReading,
	rerunBookRefinement,
	revertBookRefinement,
	type AdminChunkPatch,
	type AdminChunkType,
	type AdminReadingChunk,
	type ClutterItem,
} from '../lib/admin-api';

const CHUNK_TYPES: { value: AdminChunkType; label: string }[] = [
	{ value: 'para', label: 'Párrafo' },
	{ value: 'heading', label: 'Título' },
	{ value: 'quote', label: 'Cita' },
	{ value: 'dedication', label: 'Dedicatoria' },
	{ value: 'meta', label: 'Créditos / Meta' },
	{ value: 'toc', label: 'Índice' },
	{ value: 'caption', label: 'Epígrafe' },
	{ value: 'verse', label: 'Verso' },
	{ value: 'list', label: 'Lista' },
	{ value: 'code', label: 'Código' },
];

const CHUNK_PAGE_SIZE = 40;

/**
 * Expandable per-book AI layout/clutter & manual block editor panel (`/admin`):
 * shows AI clutter, lets the admin re-extract from PDF, re-run AI refinement,
 * revert to deterministic baseline, or manually reclassify/drop blocks in prod.
 */
export function BookClutterPanel(props: { bookId: number; open: boolean }) {
	const [clutter, setClutter] = createSignal<ClutterItem[]>([]);
	const [refinedByAi, setRefinedByAi] = createSignal(false);
	const [loaded, setLoaded] = createSignal(false);
	const [notFound, setNotFound] = createSignal(false);
	const [loading, setLoading] = createSignal(false);
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [statusMsg, setStatusMsg] = createSignal<string | null>(null);
	const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
	const [showPreview, setShowPreview] = createSignal(false);
	const [previewKey, setPreviewKey] = createSignal(0);

	// Manual block editor state
	const [showEditor, setShowEditor] = createSignal(false);
	const [chunks, setChunks] = createSignal<AdminReadingChunk[]>([]);
	const [chunksTotal, setChunksTotal] = createSignal(0);
	const [chunksOffset, setChunksOffset] = createSignal(0);
	const [chunkQuery, setChunkQuery] = createSignal('');
	const [chunkPageFilter, setChunkPageFilter] = createSignal('');
	const [chunksLoading, setChunksLoading] = createSignal(false);
	const [pendingTypeEdits, setPendingTypeEdits] = createSignal<
		Record<string, { type: AdminChunkType; level?: 1 | 2 | 3 }>
	>({});
	const [pendingDrops, setPendingDrops] = createSignal<Set<string>>(new Set());

	async function load() {
		if (loaded() || notFound() || loading()) return;
		setLoading(true);
		setError(null);
		try {
			const res = await fetchBookClutter(props.bookId);
			setClutter(res.clutter);
			setRefinedByAi(res.refinedByAi);
			setLoaded(true);
		} catch (cause) {
			const status = (cause as { status?: number }).status;
			if (status === 404) setNotFound(true);
			else setError(cause instanceof Error ? cause.message : 'No se pudo cargar la suciedad.');
		} finally {
			setLoading(false);
		}
	}

	createEffect(() => {
		if (props.open) void load();
	});

	const recommended = () => clutter().filter((item) => item.action === 'recommended');
	const dropped = () => clutter().filter((item) => item.action === 'dropped');

	function toggleSelection(id: string) {
		const next = new Set(selectedIds());
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setSelectedIds(next);
	}

	async function loadChunks(offset = chunksOffset()) {
		setChunksLoading(true);
		setError(null);
		try {
			const parsedPage = chunkPageFilter().trim() ? Number(chunkPageFilter().trim()) : undefined;
			const res = await fetchBookChunks(props.bookId, {
				q: chunkQuery(),
				page: Number.isFinite(parsedPage) ? parsedPage : undefined,
				offset,
				limit: CHUNK_PAGE_SIZE,
			});
			setChunks(res.chunks);
			setChunksTotal(res.filteredTotal);
			setChunksOffset(offset);
			setRefinedByAi(res.refinedByAi);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los bloques.');
		} finally {
			setChunksLoading(false);
		}
	}

	function bumpPreviewAndEditor() {
		setPreviewKey((k) => k + 1);
		if (showEditor()) void loadChunks(chunksOffset());
	}

	async function handleConfirmDrops() {
		const ids = Array.from(selectedIds());
		if (ids.length === 0 || busy()) return;
		setBusy(true);
		setError(null);
		try {
			const res = await dropBookClutter(props.bookId, ids);
			setClutter(res.clutter);
			setRefinedByAi(true);
			setSelectedIds(new Set<string>());
			setStatusMsg(`Se eliminaron ${res.dropped} elementos de la lectura.`);
			bumpPreviewAndEditor();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'No se pudo eliminar.');
		} finally {
			setBusy(false);
		}
	}

	async function handleRerun() {
		if (busy()) return;
		setBusy(true);
		setError(null);
		setStatusMsg(null);
		try {
			const res = await rerunBookRefinement(props.bookId);
			setClutter(res.clutter ?? []);
			setRefinedByAi(res.applied);
			setLoaded(true);
			setStatusMsg(
				res.applied
					? `Re-maquetado: ${res.reclassified} reclasificados, ${res.merged} unidos, ${res.dropped} eliminados.`
					: 'Sin cambios nuevos del refinador.',
			);
			bumpPreviewAndEditor();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'No se pudo re-maquetar.');
		} finally {
			setBusy(false);
		}
	}

	async function handleReextract() {
		if (busy()) return;
		setBusy(true);
		setError(null);
		setStatusMsg(null);
		try {
			const res = await reextractBookReading(props.bookId);
			setClutter(res.clutter ?? []);
			setRefinedByAi(res.applied);
			setLoaded(true);
			setPendingTypeEdits({});
			setPendingDrops(new Set<string>());
			setStatusMsg(
				`PDF re-extraído (${res.totalChunks} bloques${res.applied ? `, IA: ${res.reclassified} reclasificados, ${res.dropped} eliminados` : ''}).`,
			);
			bumpPreviewAndEditor();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'No se pudo re-extraer el PDF.');
		} finally {
			setBusy(false);
		}
	}

	async function handleRevert() {
		if (busy()) return;
		setBusy(true);
		setError(null);
		try {
			await revertBookRefinement(props.bookId);
			setRefinedByAi(false);
			setClutter([]);
			setSelectedIds(new Set<string>());
			setPendingTypeEdits({});
			setPendingDrops(new Set<string>());
			setStatusMsg('Se restauró la versión determinista original.');
			bumpPreviewAndEditor();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'No hay versión determinista guardada.');
		} finally {
			setBusy(false);
		}
	}

	function setChunkTypeEdit(chunk: AdminReadingChunk, nextType: AdminChunkType, nextLevel?: 1 | 2 | 3) {
		const next = { ...pendingTypeEdits() };
		const resolvedLevel = nextType === 'heading' ? (nextLevel ?? chunk.level ?? 2) : undefined;
		if (nextType === chunk.type && (nextType !== 'heading' || resolvedLevel === chunk.level)) {
			delete next[chunk.id];
		} else {
			next[chunk.id] = { type: nextType, ...(resolvedLevel ? { level: resolvedLevel } : {}) };
		}
		setPendingTypeEdits(next);
	}

	function toggleChunkDrop(id: string) {
		const next = new Set(pendingDrops());
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setPendingDrops(next);
	}

	const pendingPatchCount = () =>
		Object.keys(pendingTypeEdits()).length + pendingDrops().size;

	async function handleSaveChunkEdits() {
		if (busy() || pendingPatchCount() === 0) return;
		const patches: AdminChunkPatch[] = [];
		for (const id of pendingDrops()) {
			patches.push({ op: 'drop', id, reason: 'Eliminado manualmente en /admin' });
		}
		for (const [id, edit] of Object.entries(pendingTypeEdits())) {
			if (pendingDrops().has(id)) continue;
			patches.push({
				op: 'reclassify',
				id,
				type: edit.type,
				...(edit.level ? { level: edit.level } : {}),
			});
		}
		setBusy(true);
		setError(null);
		try {
			await patchBookChunks(props.bookId, patches);
			setRefinedByAi(true);
			setPendingTypeEdits({});
			setPendingDrops(new Set<string>());
			setStatusMsg(`Se guardaron ${patches.length} cambios de diseño.`);
			setPreviewKey((k) => k + 1);
			await loadChunks(chunksOffset());
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'No se pudieron guardar los cambios.');
		} finally {
			setBusy(false);
		}
	}

	function toggleEditor() {
		const next = !showEditor();
		setShowEditor(next);
		if (next && chunks().length === 0) {
			void loadChunks(0);
		}
	}

	return (
		<Show when={props.open}>
			<div class="firewall-panel clutter-panel" role="region" aria-label="Maquetación IA y lista de suciedad">
				<Show when={loading() && !loaded()}>
					<p class="firewall-note">Cargando maquetación y suciedad…</p>
				</Show>
				<Show when={error()}>
					<p class="firewall-note firewall-error">{error()}</p>
				</Show>
				<Show when={notFound()}>
					<p class="firewall-note">Este libro todavía no tiene lectura extraída.</p>
				</Show>
				<Show when={loaded()}>
					<div class="clutter-head">
						<span class="firewall-summary" data-verdict={refinedByAi() ? 'ok' : 'skipped'}>
							{refinedByAi() ? 'Maquetación refinada por IA' : 'Solo extractor determinista'}
						</span>
						<div class="clutter-actions">
							<button
								class="btn-ghost"
								type="button"
								onClick={() => setShowPreview(!showPreview())}
							>
								{showPreview() ? 'Ocultar preview' : 'Ver preview'}
							</button>
							<button class="btn-ghost" type="button" onClick={toggleEditor}>
								{showEditor() ? 'Cerrar editor' : 'Editar bloques'}
							</button>
							<button class="btn-ghost" type="button" disabled={busy()} onClick={() => void handleReextract()}>
								{busy() ? 'Procesando…' : 'Re-extraer PDF'}
							</button>
							<button class="btn-ghost" type="button" disabled={busy()} onClick={() => void handleRerun()}>
								{busy() ? 'Procesando…' : 'Re-maquetar IA'}
							</button>
							<button class="btn-ghost" type="button" disabled={busy()} onClick={() => void handleRevert()}>
								Volver a determinista
							</button>
						</div>
					</div>

					<Show when={showPreview()}>
						<div class="clutter-preview">
							<iframe
								src={`/lecturas/${props.bookId}?v=${previewKey()}`}
								title={`Preview de lectura del libro ${props.bookId}`}
								loading="lazy"
							/>
						</div>
					</Show>

					<Show when={showEditor()}>
						<div class="chunk-editor">
							<form
								class="chunk-editor-filters"
								onSubmit={(e) => {
									e.preventDefault();
									void loadChunks(0);
								}}
							>
								<input
									type="text"
									class="chunk-filter-input"
									placeholder="Buscar texto…"
									value={chunkQuery()}
									onInput={(e) => setChunkQuery(e.currentTarget.value)}
								/>
								<input
									type="number"
									min="1"
									class="chunk-filter-page"
									placeholder="Pág."
									value={chunkPageFilter()}
									onInput={(e) => setChunkPageFilter(e.currentTarget.value)}
								/>
								<button class="btn-ghost" type="submit" disabled={chunksLoading()}>
									Filtrar
								</button>
								<Show when={pendingPatchCount() > 0}>
									<button
										class="btn-approve"
										type="button"
										disabled={busy()}
										onClick={() => void handleSaveChunkEdits()}
									>
										Guardar cambios ({pendingPatchCount()})
									</button>
								</Show>
							</form>

							<Show when={chunksLoading()}>
								<p class="firewall-note">Cargando bloques…</p>
							</Show>

							<Show when={!chunksLoading() && chunks().length === 0}>
								<p class="firewall-note">No hay bloques que coincidan con el filtro.</p>
							</Show>

							<Show when={chunks().length > 0}>
								<ul class="chunk-list">
									<For each={chunks()}>
										{(chunk) => {
											const isDropped = () => pendingDrops().has(chunk.id);
											const edit = () => pendingTypeEdits()[chunk.id];
											const activeType = () => edit()?.type ?? chunk.type;
											const activeLevel = () => edit()?.level ?? chunk.level ?? 2;
											return (
												<li class="chunk-row" data-dropped={isDropped() ? 'true' : 'false'}>
													<div class="chunk-controls">
														<span class="clutter-meta">p{chunk.page} · {chunk.id}</span>
														<select
															class="chunk-select"
															aria-label={`Tipo del bloque ${chunk.id}`}
															value={activeType()}
															disabled={isDropped()}
															onChange={(e) =>
																setChunkTypeEdit(
																	chunk,
																	e.currentTarget.value as AdminChunkType,
																)
															}
														>
															<For each={CHUNK_TYPES}>
																{(opt) => <option value={opt.value}>{opt.label}</option>}
															</For>
														</select>
														<Show when={activeType() === 'heading'}>
															<select
																class="chunk-select chunk-select-level"
																aria-label={`Nivel de título ${chunk.id}`}
																value={String(activeLevel())}
																disabled={isDropped()}
																onChange={(e) =>
																	setChunkTypeEdit(
																		chunk,
																		'heading',
																		Number(e.currentTarget.value) as 1 | 2 | 3,
																	)
																}
															>
																<option value="1">H1</option>
																<option value="2">H2</option>
																<option value="3">H3</option>
															</select>
														</Show>
														<button
															type="button"
															class="btn-ghost chunk-drop-btn"
															onClick={() => toggleChunkDrop(chunk.id)}
														>
															{isDropped() ? 'Restaurar' : 'Descartar'}
														</button>
													</div>
													<p class="chunk-text">
														{chunk.text.length > 220 ? `${chunk.text.slice(0, 220)}…` : chunk.text}
													</p>
												</li>
											);
										}}
									</For>
								</ul>
								<div class="chunk-pagination">
									<span class="clutter-meta">
										Mostrando {chunksOffset() + 1}–{Math.min(chunksOffset() + CHUNK_PAGE_SIZE, chunksTotal())} de {chunksTotal()}
									</span>
									<div class="clutter-actions">
										<button
											class="btn-ghost"
											type="button"
											disabled={chunksLoading() || chunksOffset() === 0}
											onClick={() => void loadChunks(Math.max(0, chunksOffset() - CHUNK_PAGE_SIZE))}
										>
											Anterior
										</button>
										<button
											class="btn-ghost"
											type="button"
											disabled={chunksLoading() || chunksOffset() + CHUNK_PAGE_SIZE >= chunksTotal()}
											onClick={() => void loadChunks(chunksOffset() + CHUNK_PAGE_SIZE)}
										>
											Siguiente
										</button>
									</div>
								</div>
							</Show>
						</div>
					</Show>

					<Show when={statusMsg()}>
						<p class="firewall-note">{statusMsg()}</p>
					</Show>

					<Show when={clutter().length === 0}>
						<p class="firewall-note">Sin suciedad detectada ni recomendaciones pendientes.</p>
					</Show>

					<Show when={recommended().length > 0}>
						<div class="clutter-group">
							<p class="tier-head">
								<span class="tier-name">Recomendados para sacar ({recommended().length})</span>
							</p>
							<ul class="clutter-list">
								<For each={recommended()}>
									{(item) => (
										<li class="clutter-item">
											<label class="clutter-check">
												<input
													type="checkbox"
													checked={selectedIds().has(item.id)}
													onChange={() => toggleSelection(item.id)}
												/>
												<span class="clutter-meta">pág. {item.page}</span>
												<span class="clutter-text">«{item.text}»</span>
												<span class="clutter-reason">{item.reason}</span>
											</label>
										</li>
									)}
								</For>
							</ul>
							<Show when={selectedIds().size > 0}>
								<button
									class="btn-secondary"
									type="button"
									disabled={busy()}
									onClick={() => void handleConfirmDrops()}
								>
									Sacar seleccionados ({selectedIds().size})
								</button>
							</Show>
						</div>
					</Show>

					<Show when={dropped().length > 0}>
						<div class="clutter-group">
							<p class="tier-head">
								<span class="tier-name">Eliminados automáticamente ({dropped().length})</span>
							</p>
							<ul class="clutter-list">
								<For each={dropped()}>
									{(item) => (
										<li class="clutter-item is-dropped">
											<span class="clutter-meta">pág. {item.page}</span>
											<span class="clutter-text">«{item.text}»</span>
											<span class="clutter-reason">{item.reason}</span>
										</li>
									)}
								</For>
							</ul>
						</div>
					</Show>
				</Show>
			</div>
		</Show>
	);
}
