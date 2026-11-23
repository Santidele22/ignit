import { For, createSignal, onCleanup, onMount } from 'solid-js';
import { signOutCleanly } from '../../auth/api/authActions';
import {
	PALETTE_CHANGE_EVENT,
	applyPaletteToDocument,
	readDocumentPalette,
	type AppPalette,
} from '../../../shared/lib/palette';
import type { SalaTabId } from '../lib/sala';

/**
 * Sticky topbar of the Sala de lectura (S2).
 *
 * Owns the accessible `role="tablist"` (← / → with wrap-around, roving
 * `tabindex`), the real online/offline indicator with its manual test toggle,
 * the discrete 2-palette group (`palette.ts` is the single source of truth for
 * the document), the `+ Subir libro` entry point and the authenticated
 * `.user-pill` with the CSP-safe sign-out.
 */
export interface SalaTopbarProps {
	activeTab: SalaTabId;
	counts: Record<SalaTabId, number>;
	isOffline: boolean;
	userLabel: string;
	onTabChange: (tab: SalaTabId) => void;
	onToggleOffline: () => void;
	onOpenUpload: () => void;
}

const TABS: ReadonlyArray<{ id: SalaTabId; label: string }> = [
	{ id: 'device', label: 'En este dispositivo' },
	{ id: 'library', label: 'Mi biblioteca' },
	{ id: 'catalog', label: 'Catálogo' },
	{ id: 'submissions', label: 'Mis aportes' },
];

const PALETTES: ReadonlyArray<{ id: AppPalette; label: string }> = [
	{ id: 'noche-azul', label: 'Noche azul' },
	{ id: 'original', label: 'Original' },
];

export default function SalaTopbar(props: SalaTopbarProps) {
	const [palette, setPalette] = createSignal<AppPalette>('noche-azul');
	const [signingOut, setSigningOut] = createSignal(false);
	let tabRefs: HTMLButtonElement[] = [];

	const avatarInitial = () => {
		const trimmed = props.userLabel.trim();
		return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : '·';
	};

	function selectPalette(next: AppPalette) {
		const applied = applyPaletteToDocument(next, { save: true, emit: true });
		setPalette(applied);
	}

	function handleTabKeyDown(event: KeyboardEvent, index: number) {
		if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
		event.preventDefault();
		const delta = event.key === 'ArrowRight' ? 1 : -1;
		const nextIndex = (index + delta + TABS.length) % TABS.length;
		const next = TABS[nextIndex];
		if (!next) return;
		props.onTabChange(next.id);
		tabRefs[nextIndex]?.focus();
	}

	async function handleSignOut() {
		if (signingOut()) return;
		setSigningOut(true);
		try {
			await signOutCleanly();
		} finally {
			window.location.assign('/');
		}
	}

	onMount(() => {
		setPalette(readDocumentPalette());

		const onPaletteChange = (event: Event) => {
			const detail = (event as CustomEvent<{ palette?: AppPalette }>).detail;
			const next = detail?.palette;
			if (next === 'original' || next === 'noche-azul') setPalette(next);
		};
		window.addEventListener(PALETTE_CHANGE_EVENT, onPaletteChange);
		onCleanup(() => window.removeEventListener(PALETTE_CHANGE_EVENT, onPaletteChange));
	});

	return (
		<header class="app-top">
			<div class="top-inner">
				<a class="brand" href="/">
					<span class="sello" aria-hidden="true">
						熒
					</span>
					Ignit
				</a>

				<nav class="top-tabs" role="tablist" aria-label="Espacio de lectura">
					<For each={TABS}>
						{(tab, index) => (
							<button
								ref={(element) => {
									tabRefs[index()] = element;
								}}
								class="top-tab"
								id={`tab-${tab.id}`}
								type="button"
								role="tab"
								aria-selected={props.activeTab === tab.id}
								aria-controls={`view-${tab.id}`}
								data-active={String(props.activeTab === tab.id)}
								tabindex={props.activeTab === tab.id ? 0 : -1}
								onClick={() => props.onTabChange(tab.id)}
								onKeyDown={(event) => handleTabKeyDown(event, index())}
							>
								{tab.label} <span class="tab-count">{props.counts[tab.id]}</span>
							</button>
						)}
					</For>
				</nav>

				<div class="top-actions">
					<button
						class="net-toggle"
						type="button"
						aria-pressed={props.isOffline}
						title="Probar estado online / offline"
						onClick={() => props.onToggleOffline()}
					>
						<span class="net-dot" aria-hidden="true" />
						<span>{props.isOffline ? 'Offline · leyendo local' : 'Online · sync al día'}</span>
					</button>

					<div class="palette-mini" role="group" aria-label="Paleta de colores">
						<For each={PALETTES}>
							{(option) => (
								<button
									type="button"
									data-palette-option={option.id}
									aria-pressed={palette() === option.id}
									onClick={() => selectPalette(option.id)}
								>
									{option.label}
								</button>
							)}
						</For>
					</div>

					<button class="btn-primary" type="button" onClick={() => props.onOpenUpload()}>
						+ Subir libro
					</button>

					<div class="user-pill">
						<span class="user-avatar" aria-hidden="true">
							{avatarInitial()}
						</span>
						<span title={props.userLabel}>{props.userLabel}</span>
						<button
							class="btn-ghost"
							type="button"
							disabled={signingOut()}
							onClick={() => void handleSignOut()}
						>
							{signingOut() ? 'Saliendo…' : 'Salir'}
						</button>
					</div>
				</div>
			</div>
		</header>
	);
}
