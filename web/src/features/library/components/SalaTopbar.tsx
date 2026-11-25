import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { signOutCleanly } from '../../auth/api/authActions';
import { subscribeInstallMode, triggerInstall, type InstallMode } from '../../pwa/installPrompt';
import {
	PALETTE_CHANGE_EVENT,
	applyPaletteToDocument,
	readDocumentPalette,
	type AppPalette,
} from '../../../shared/lib/palette';
import { SALA_TABS, nextSalaTabId, type SalaTabId } from '../lib/sala';

/**
 * Sticky topbar of the Sala de lectura (S1/S2).
 *
 * One single responsive header for both breakpoints:
 *
 * - `> 768px`: the desktop sala header — brand, the `role="tablist"` with the
 *   full labels, online/offline indicator, palette group, `+ Subir libro` and
 *   the authenticated `.user-pill`.
 * - `<= 768px`: the same `role="tablist"` becomes the fixed PWA bottom tab bar
 *   (icons + short labels + count badges), while `.top-inner` collapses to a
 *   ~56px single row with `熒 Ignit`, a compact `+ Subir` and the account-avatar
 *   toggle
 *   that opens `#sala-mobile-menu` (network toggle, palette, user + `Salir`).
 *
 * The tablist is rendered exactly once, so `id="tab-*"` stays unique and the
 * roving `tabindex` / `ArrowLeft`–`ArrowRight` navigation work on both layouts.
 * No new inline `<script>`: the menu is plain SolidJS state (CSP untouched).
 */
export interface SalaTopbarProps {
	activeTab: SalaTabId;
	counts: Record<SalaTabId, number>;
	isOffline: boolean;
	userLabel: string;
	isAdmin?: boolean;
	onTabChange: (tab: SalaTabId) => void;
	onToggleOffline: () => void;
	onOpenUpload: () => void;
}

const PALETTES: ReadonlyArray<{ id: AppPalette; label: string }> = [
	{ id: 'noche-azul', label: 'Noche azul' },
	{ id: 'original', label: 'Original' },
];

/** Crisp 24×24 stroke icons of the bottom tab bar (decorative only). */
const TAB_ICON_PATHS: Record<SalaTabId, readonly string[]> = {
	device: ['M4.5 5.5h15v10h-15z', 'M9.5 19.5h5', 'M12 15.5v4'],
	library: ['M5 4.5h4v15H5z', 'M10.5 4.5h4v15h-4z', 'M16.5 6l3 13.4'],
	catalog: ['M4.5 4.5h6v6h-6z', 'M13.5 4.5h6v6h-6z', 'M4.5 13.5h6v6h-6z', 'M13.5 13.5h6v6h-6z'],
	submissions: ['M12 16.5V5.5', 'M7.5 10 12 5.5 16.5 10', 'M4.5 19.5h15'],
};

/** Real online/offline indicator with its manual test toggle. */
function NetToggle(props: { isOffline: boolean; onToggleOffline: () => void }) {
	return (
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
	);
}

/** Discrete 2-palette group; `palette.ts` stays the single document source. */
function PaletteGroup(props: { palette: AppPalette; onSelect: (next: AppPalette) => void }) {
	return (
		<div class="palette-mini" role="group" aria-label="Paleta de colores">
			<For each={PALETTES}>
				{(option) => (
					<button
						type="button"
						data-palette-option={option.id}
						aria-pressed={props.palette === option.id}
						onClick={() => props.onSelect(option.id)}
					>
						{option.label}
					</button>
				)}
			</For>
		</div>
	);
}

/** Authenticated pill with the CSP-safe sign-out. */
function UserPill(props: { label: string; signingOut: boolean; onSignOut: () => void }) {
	const initial = () => {
		const trimmed = props.label.trim();
		return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : '·';
	};

	return (
		<div class="user-pill">
			<span class="user-avatar" aria-hidden="true">
				{initial()}
			</span>
			<span class="user-name" title={props.label}>
				{props.label}
			</span>
			<button
				class="btn-ghost"
				type="button"
				disabled={props.signingOut}
				onClick={() => props.onSignOut()}
			>
				{props.signingOut ? 'Saliendo…' : 'Salir'}
			</button>
		</div>
	);
}

export default function SalaTopbar(props: SalaTopbarProps) {
	const [palette, setPalette] = createSignal<AppPalette>('noche-azul');
	const [signingOut, setSigningOut] = createSignal(false);
	const [menuOpen, setMenuOpen] = createSignal(false);
	const [installMode, setInstallMode] = createSignal<InstallMode>('hidden');

	const avatarInitial = () => {
		const trimmed = props.userLabel.trim();
		return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : '·';
	};

	let tabRefs: HTMLButtonElement[] = [];
	let menuToggleRef: HTMLButtonElement | undefined;
	let menuRef: HTMLDivElement | undefined;

	function selectPalette(next: AppPalette) {
		const applied = applyPaletteToDocument(next, { save: true, emit: true });
		setPalette(applied);
	}

	function closeMenu(restoreFocus = false) {
		if (!menuOpen()) return;
		setMenuOpen(false);
		if (restoreFocus) menuToggleRef?.focus();
	}

	function toggleMenu() {
		const next = !menuOpen();
		setMenuOpen(next);
		if (next) return;
		menuToggleRef?.focus();
	}

	function handleTabKeyDown(event: KeyboardEvent, index: number) {
		if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
		event.preventDefault();
		const next = nextSalaTabId(SALA_TABS[index]?.id ?? 'device', event.key === 'ArrowRight' ? 1 : -1);
		const nextIndex = SALA_TABS.findIndex((entry) => entry.id === next);
		props.onTabChange(next);
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

	async function handleInstallApp() {
		closeMenu();
		await triggerInstall();
	}

	onMount(() => {
		setPalette(readDocumentPalette());

		const unsubscribeInstall = subscribeInstallMode((mode) => setInstallMode(mode));

		const onPaletteChange = (event: Event) => {
			const detail = (event as CustomEvent<{ palette?: AppPalette }>).detail;
			const next = detail?.palette;
			if (next === 'original' || next === 'noche-azul') setPalette(next);
		};
		window.addEventListener(PALETTE_CHANGE_EVENT, onPaletteChange);
		onCleanup(() => {
			unsubscribeInstall();
			window.removeEventListener(PALETTE_CHANGE_EVENT, onPaletteChange);
		});
	});

	// Compact menu panel: `Escape` closes it and returns focus to the toggle,
	// any pointer press outside the panel (bottom tab bar included) dismisses it.
	onMount(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || !menuOpen()) return;
			event.preventDefault();
			closeMenu(true);
		};
		const onPointerDown = (event: PointerEvent) => {
			if (!menuOpen()) return;
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (menuRef?.contains(target)) return;
			if (menuToggleRef?.contains(target)) return;
			closeMenu();
		};

		document.addEventListener('keydown', onKeyDown);
		document.addEventListener('pointerdown', onPointerDown);
		onCleanup(() => {
			document.removeEventListener('keydown', onKeyDown);
			document.removeEventListener('pointerdown', onPointerDown);
		});
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
					<For each={SALA_TABS}>
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
								<svg
									class="tab-icon"
									viewBox="0 0 24 24"
									aria-hidden="true"
									fill="none"
									stroke="currentColor"
									stroke-width="1.6"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<For each={TAB_ICON_PATHS[tab.id]}>{(d) => <path d={d} />}</For>
								</svg>
								<span class="tab-label">{tab.label}</span>
								<span class="tab-label-short">{tab.shortLabel}</span>
								<span class="tab-count">{props.counts[tab.id]}</span>
							</button>
						)}
					</For>
				</nav>

				<div class="top-actions">
					<NetToggle isOffline={props.isOffline} onToggleOffline={props.onToggleOffline} />
					<PaletteGroup palette={palette()} onSelect={selectPalette} />
					<Show when={installMode() !== 'hidden'}>
						<button class="btn-ghost" type="button" onClick={() => void handleInstallApp()}>
							Instalar app
						</button>
					</Show>
					<Show when={props.isAdmin}>
						<a class="btn-ghost" href="/admin">
							Admin
						</a>
					</Show>
					<button class="btn-primary" type="button" onClick={() => props.onOpenUpload()}>
						+ Subir libro
					</button>
					<UserPill
						label={props.userLabel}
						signingOut={signingOut()}
						onSignOut={() => void handleSignOut()}
					/>
				</div>

				<div class="top-compact-actions">
					<Show when={installMode() !== 'hidden'}>
						<button
							class="btn-ghost btn-install-mini"
							type="button"
							aria-label="Instalar app"
							title="Instalar app"
							onClick={() => void handleInstallApp()}
						>
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M12 4v11" />
								<path d="M7.5 11.5 12 16l4.5-4.5" />
								<path d="M4.5 19.5h15" />
							</svg>
						</button>
					</Show>
					<button
						class="btn-primary btn-subir-mini"
						type="button"
						aria-label="Subir libro"
						onClick={() => props.onOpenUpload()}
					>
						+ Subir
					</button>
					<button
						ref={(element) => {
							menuToggleRef = element;
						}}
						class="mobile-menu-toggle"
						type="button"
						aria-expanded={menuOpen()}
						aria-haspopup="dialog"
						aria-controls="sala-mobile-menu"
						aria-label={`Cuenta y ajustes de ${props.userLabel}`}
						title="Cuenta y ajustes"
						onClick={() => toggleMenu()}
					>
						<span class="avatar-initial" aria-hidden="true">
							{avatarInitial()}
						</span>
					</button>
				</div>
			</div>

			<div
				ref={(element) => {
					menuRef = element;
				}}
				class="mobile-menu"
				id="sala-mobile-menu"
				data-open={String(menuOpen())}
				hidden={!menuOpen()}
			>
				<Show when={menuOpen()}>
					<NetToggle isOffline={props.isOffline} onToggleOffline={props.onToggleOffline} />
					<PaletteGroup palette={palette()} onSelect={selectPalette} />
					<Show when={installMode() !== 'hidden'}>
						<button class="btn-ghost" type="button" onClick={() => void handleInstallApp()}>
							Instalar app
						</button>
					</Show>
					<Show when={props.isAdmin}>
						<a class="btn-ghost" href="/admin">
							Admin
						</a>
					</Show>
					<UserPill
						label={props.userLabel}
						signingOut={signingOut()}
						onSignOut={() => void handleSignOut()}
					/>
				</Show>
			</div>
		</header>
	);
}
