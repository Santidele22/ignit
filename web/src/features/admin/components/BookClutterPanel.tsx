import { For, Show, createEffect, createSignal } from 'solid-js';
import {
	dropBookClutter,
	fetchBookClutter,
	rerunBookRefinement,
	revertBookRefinement,
	type ClutterItem,
} from '../lib/admin-api';

/**
 * Expandable per-book AI layout/clutter panel (`/admin`): shows what the LLM
 * automatically dropped (`ePUB v2.1`, page numbers) and what it recommends
 * dropping (`陰翳礼讃`, colophons), letting the admin confirm drops, re-run
 * refinement, or revert to the deterministic baseline.
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
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'No se pudo re-maquetar.');
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
			setStatusMsg('Se restauró la versión determinista original.');
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'No hay versión determinista guardada.');
		} finally {
			setBusy(false);
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
								src={`/lecturas/${props.bookId}`}
								title={`Preview de lectura del libro ${props.bookId}`}
								loading="lazy"
							/>
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
