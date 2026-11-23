// App-wide color palette model, persistence and DOM synchronization.
// Shared by the global header toggle and the Vigilia reader preferences deck.

export type AppPalette = 'noche-azul' | 'original';

export const DEFAULT_PALETTE: AppPalette = 'noche-azul';
export const PALETTE_STORAGE_KEY = 'ignit:palette';
export const THEME_STORAGE_KEY = 'santi-theme';
export const PALETTE_CHANGE_EVENT = 'ignit:palette-change';

export type DocumentThemeState = {
	palette: AppPalette;
	dark: boolean;
	colorScheme: 'dark' | 'light';
};

export function parsePalette(raw: string | null | undefined): AppPalette {
	if (raw === 'original') return 'original';
	if (raw === 'noche-azul') return 'noche-azul';
	return DEFAULT_PALETTE;
}

export function resolveDocumentThemeState(
	palette: AppPalette,
	savedDarkMode: string | null,
	prefersDark: boolean,
): DocumentThemeState {
	if (palette === 'noche-azul') {
		return {
			palette: 'noche-azul',
			dark: true,
			colorScheme: 'dark',
		};
	}

	const dark = savedDarkMode ? savedDarkMode === 'dark' : prefersDark;
	return {
		palette: 'original',
		dark,
		colorScheme: dark ? 'dark' : 'light',
	};
}

export function readStoredPalette(): AppPalette {
	try {
		return parsePalette(localStorage.getItem(PALETTE_STORAGE_KEY));
	} catch {
		return DEFAULT_PALETTE;
	}
}

export function readDocumentPalette(): AppPalette {
	if (typeof document === 'undefined') return DEFAULT_PALETTE;
	return parsePalette(document.documentElement.dataset.palette ?? readStoredPalette());
}

export function syncPaletteButtons(
	palette: AppPalette,
	scope: ParentNode = document,
): void {
	scope.querySelectorAll<HTMLButtonElement>('[data-palette-option]').forEach((btn) => {
		const active = btn.dataset.paletteOption === palette;
		btn.setAttribute('aria-pressed', String(active));
		btn.dataset.on = String(active);
	});
}

export function applyPaletteToDocument(
	palette: AppPalette,
	options?: { save?: boolean; emit?: boolean },
): AppPalette {
	const next = parsePalette(palette);
	if (typeof document === 'undefined') return next;

	let savedDarkMode: string | null = null;
	try {
		savedDarkMode = localStorage.getItem(THEME_STORAGE_KEY);
	} catch {}

	const prefersDark =
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-color-scheme: dark)').matches;

	const state = resolveDocumentThemeState(next, savedDarkMode, prefersDark);
	const root = document.documentElement;
	root.dataset.palette = state.palette;
	root.classList.toggle('dark', state.dark);
	root.style.colorScheme = state.colorScheme;

	if (options?.save !== false) {
		try {
			localStorage.setItem(PALETTE_STORAGE_KEY, state.palette);
		} catch {}
	}

	syncPaletteButtons(state.palette);

	if (options?.emit !== false && typeof window !== 'undefined') {
		window.dispatchEvent(
			new CustomEvent<{ palette: AppPalette }>(PALETTE_CHANGE_EVENT, {
				detail: { palette: state.palette },
			}),
		);
	}

	return state.palette;
}

let globalSyncInstalled = false;

export function initPaletteControls(options?: {
	onSelect?: (palette: AppPalette) => void;
}): void {
	if (typeof document === 'undefined' || typeof window === 'undefined') return;

	const current = readStoredPalette();
	applyPaletteToDocument(current, { save: false, emit: false });

	document.querySelectorAll<HTMLButtonElement>('[data-palette-option]').forEach((btn) => {
		if (btn.dataset.paletteBound === 'true') return;
		btn.dataset.paletteBound = 'true';
		btn.addEventListener('click', () => {
			const chosen = parsePalette(btn.dataset.paletteOption);
			const previous = readDocumentPalette();
			applyPaletteToDocument(chosen, { save: true, emit: true });
			if (chosen !== previous) {
				options?.onSelect?.(chosen);
			}
		});
	});

	if (globalSyncInstalled) return;
	globalSyncInstalled = true;

	window.addEventListener(PALETTE_CHANGE_EVENT, (event) => {
		const detail = (event as CustomEvent<{ palette?: AppPalette }>).detail;
		syncPaletteButtons(parsePalette(detail?.palette ?? readDocumentPalette()));
	});

	window.addEventListener('storage', (event) => {
		if (event.key === PALETTE_STORAGE_KEY || event.key === THEME_STORAGE_KEY) {
			applyPaletteToDocument(readStoredPalette(), { save: false, emit: false });
		}
	});

	const media = window.matchMedia?.('(prefers-color-scheme: dark)');
	media?.addEventListener?.('change', () => {
		if (readDocumentPalette() === 'original') {
			applyPaletteToDocument('original', { save: false, emit: false });
		}
	});
}
