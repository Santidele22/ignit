/**
 * Aviso «Ignit se abrió en el navegador»: mientras la app corre en una pestaña
 * del browser (no standalone), muestra una barra discreta que invita a instalar
 * o reinstalar la PWA para que se abra como aplicación nativa.
 *
 * - 100% seguro para SSR/Node: ningún acceso a `window`/`document`/`localStorage`
 *   se ejecuta sin guard.
 * - CSP-safe: el DOM se construye con `document.createElement` (cero `innerHTML`),
 *   y su CSS viaja en `browser-banner.css` empaquetado por Vite.
 */
import './browser-banner.css';
import { subscribeInstallMode, triggerInstall, type InstallMode } from './installPrompt';

export const BROWSER_BANNER_ID = 'ignit-browser-mode-banner';
export const DISMISS_STORAGE_KEY = 'ignit.pwa.browser-banner-dismissed';

type BannerEvent = {
	target?: unknown;
	preventDefault(): void;
};

type BannerElement = {
	id: string;
	type?: string;
	className: string;
	textContent: string;
	appendChild(node: BannerElement): void;
	setAttribute(name: string, value: string): void;
	addEventListener(type: 'click', listener: (event: BannerEvent) => void): void;
	remove(): void;
};

type BannerDocument = {
	createElement(tag: string): BannerElement;
	getElementById(id: string): BannerElement | null;
	body: { appendChild(node: BannerElement): void };
};

/** Pure decision helper: the banner applies when the app runs in a browser tab
 * (any non-hidden install mode) and the user has not dismissed it. */
export function shouldShowBrowserBanner(mode: InstallMode, dismissed: boolean): boolean {
	return !dismissed && mode !== 'hidden';
}

/** Reads the persisted dismissal; missing or inaccessible storage counts as not dismissed. */
export function readBrowserModeBannerDismissed(): boolean {
	if (typeof window === 'undefined' || typeof (window as { localStorage?: Storage }).localStorage === 'undefined') {
		return false;
	}
	try {
		return (window as { localStorage: Storage }).localStorage.getItem(DISMISS_STORAGE_KEY) === '1';
	} catch {
		return false;
	}
}

/** Persists the dismissal; storage failures are swallowed (banner reappears next visit). */
export function dismissBrowserModeBanner(): void {
	if (typeof window === 'undefined' || typeof (window as { localStorage?: Storage }).localStorage === 'undefined') {
		return;
	}
	try {
		(window as { localStorage: Storage }).localStorage.setItem(DISMISS_STORAGE_KEY, '1');
	} catch {
		// Storage may be full or blocked; the banner simply reappears next visit.
	}
}

function renderBanner(doc: BannerDocument): void {
	const existing = doc.getElementById(BROWSER_BANNER_ID);
	if (existing) return;

	const banner = doc.createElement('aside');
	banner.id = BROWSER_BANNER_ID;
	banner.className = 'pwa-browser-banner';
	banner.setAttribute('role', 'region');
	banner.setAttribute('aria-label', 'Instalar Ignit como aplicación');

	const text = doc.createElement('p');
	text.className = 'pwa-browser-banner-text';
	text.textContent = 'Ignit se abrió en el navegador. Instalá la app para usarla como aplicación nativa.';

	const installBtn = doc.createElement('button');
	installBtn.type = 'button';
	installBtn.className = 'pwa-browser-banner-action';
	installBtn.textContent = 'Instalar app';

	const closeBtn = doc.createElement('button');
	closeBtn.type = 'button';
	closeBtn.className = 'pwa-browser-banner-close';
	closeBtn.setAttribute('aria-label', 'Descartar aviso de instalación');
	closeBtn.textContent = '✕';

	banner.appendChild(text);
	banner.appendChild(installBtn);
	banner.appendChild(closeBtn);
	doc.body.appendChild(banner);

	installBtn.addEventListener('click', (event) => {
		event.preventDefault();
		void triggerInstall();
	});
	closeBtn.addEventListener('click', (event) => {
		event.preventDefault();
		dismissBrowserModeBanner();
		banner.remove();
	});

	// Tapping the banner body (outside the buttons) also offers the install action.
	banner.addEventListener('click', (event) => {
		if (event.target === banner) {
			event.preventDefault();
			void triggerInstall();
		}
	});
}

let bound = false;

/**
 * Subscribes to install mode changes and shows/removes the browser-mode banner.
 * Idempotent (it binds the subscription once); no-op outside the browser (SSR).
 */
export function initBrowserModeBanner(targetDoc?: Document): void {
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	if (!bound) {
		bound = true;
		// subscribeInstallMode invokes its listener immediately with the current
		// mode, then again on every change: that covers init and updates alike.
		subscribeInstallMode((mode) => syncBanner(mode, targetDoc));
		return;
	}
	// Late re-init (multiple layouts): installPrompt's subscription state is
	// authoritative, so replay the current mode through a fresh one-shot listener.
	subscribeInstallMode((mode) => syncBanner(mode, targetDoc))();
}

function syncBanner(mode: InstallMode, targetDoc?: Document): void {
	if (typeof document === 'undefined') return;
	if (!shouldShowBrowserBanner(mode, readBrowserModeBannerDismissed())) {
		document.getElementById(BROWSER_BANNER_ID)?.remove();
		return;
	}
	renderBanner((targetDoc ?? document) as unknown as BannerDocument);
}
