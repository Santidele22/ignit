/**
 * Controlador de instalación PWA para Android (beforeinstallprompt) y guía
 * discreta para iOS/iPadOS («Agregar a pantalla de inicio»).
 *
 * - 100% seguro para SSR/Node: ningún acceso a `window`/`document`/`navigator`
 *   se ejecuta sin guard.
 * - CSP-safe: todo el DOM del diálogo iOS se construye con `document.createElement`
 *   (cero `innerHTML`), y su CSS viaja en `install-guide.css` empaquetado por Vite.
 */
import './install-guide.css';

export type InstallMode = 'hidden' | 'prompt' | 'ios-guide' | 'manual-guide';
export type InstallTriggerOutcome = 'accepted' | 'dismissed' | 'ios-guide' | 'manual-guide' | 'unavailable';

export interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface StandaloneEnvironment {
	matchMediaStandalone?: boolean;
	navigatorStandalone?: boolean;
}

export interface InstallModeEnvironment {
	standalone: boolean;
	hasDeferredPrompt: boolean;
	isIos: boolean;
}

export const IOS_GUIDE_DIALOG_ID = 'ignit-ios-install-guide';

/** True when the app is already running installed (standalone display mode). */
export function isStandaloneDisplayMode(env: StandaloneEnvironment): boolean {
	return Boolean(env.matchMediaStandalone || env.navigatorStandalone);
}

/** True on iPhone, iPad, iPod, and iPadOS desktop-mode Safari. */
export function isIosDevice(userAgent: string, maxTouchPoints = 0): boolean {
	if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
	return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

/** Pure decision helper for whether/how to expose the «Instalar app» affordance. */
export function getInstallMode(env: InstallModeEnvironment): InstallMode {
	if (env.standalone) return 'hidden';
	if (env.hasDeferredPrompt) return 'prompt';
	if (env.isIos) return 'ios-guide';
	return 'manual-guide';
}

type ModeListener = (mode: InstallMode) => void;

let initialized = false;
let installedInSession = false;
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<ModeListener>();

function readCurrentMode(): InstallMode {
	if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'hidden';
	if (installedInSession) return 'hidden';

	const matchMediaStandalone =
		typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
	const navigatorStandalone = Boolean((navigator as { standalone?: boolean }).standalone);
	const standalone = isStandaloneDisplayMode({ matchMediaStandalone, navigatorStandalone });

	return getInstallMode({
		standalone,
		hasDeferredPrompt: deferredPrompt !== null,
		isIos: isIosDevice(navigator.userAgent ?? '', navigator.maxTouchPoints ?? 0),
	});
}

function notifyListeners(): void {
	const mode = readCurrentMode();
	for (const listener of listeners) {
		listener(mode);
	}
}

export function closeIosInstallGuide(): void {
	if (typeof document === 'undefined') return;
	document.getElementById(IOS_GUIDE_DIALOG_ID)?.remove();
}

function showInstallGuide(doc: Document, variant: 'ios' | 'manual'): void {
	closeIosInstallGuide();

	const backdrop = doc.createElement('div');
	backdrop.id = IOS_GUIDE_DIALOG_ID;
	backdrop.className = 'pwa-guide-backdrop';

	const dialog = doc.createElement('div');
	dialog.className = 'pwa-guide-dialog';
	dialog.setAttribute('role', 'dialog');
	dialog.setAttribute('aria-modal', 'true');
	dialog.setAttribute('aria-labelledby', `${IOS_GUIDE_DIALOG_ID}-title`);

	const header = doc.createElement('div');
	header.className = 'pwa-guide-head';

	const eyebrow = doc.createElement('span');
	eyebrow.className = 'pwa-guide-eyebrow';
	eyebrow.textContent = variant === 'ios' ? 'Instalar en iPhone / iPad' : 'Instalar Ignit (PWA)';

	const closeBtn = doc.createElement('button');
	closeBtn.type = 'button';
	closeBtn.className = 'pwa-guide-close';
	closeBtn.setAttribute('aria-label', 'Cerrar instrucciones de instalación');
	closeBtn.textContent = '✕';

	header.appendChild(eyebrow);
	header.appendChild(closeBtn);

	const title = doc.createElement('h2');
	title.id = `${IOS_GUIDE_DIALOG_ID}-title`;
	title.className = 'pwa-guide-title';
	title.textContent = 'Llevá Ignit a tu pantalla de inicio';

	const steps = doc.createElement('ol');
	steps.className = 'pwa-guide-steps';

	const step1 = doc.createElement('li');
	const step2 = doc.createElement('li');
	if (variant === 'ios') {
		step1.textContent = 'Tocá el botón Compartir en la barra del navegador.';
		step2.textContent = 'Elegí «Agregar a pantalla de inicio» y tocá «Agregar».';
	} else {
		step1.textContent = 'Abrí el menú del navegador (⋮) o el ícono de instalar en la barra de dirección.';
		step2.textContent = 'Elegí «Instalar aplicación» o «Agregar a pantalla de inicio».';
	}

	steps.appendChild(step1);
	steps.appendChild(step2);

	const doneBtn = doc.createElement('button');
	doneBtn.type = 'button';
	doneBtn.className = 'pwa-guide-done';
	doneBtn.textContent = 'Entendido';

	dialog.appendChild(header);
	dialog.appendChild(title);
	dialog.appendChild(steps);
	dialog.appendChild(doneBtn);
	backdrop.appendChild(dialog);

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		cleanup();
	};

	const cleanup = () => {
		doc.removeEventListener('keydown', onKeyDown);
		backdrop.remove();
	};

	closeBtn.addEventListener('click', cleanup);
	doneBtn.addEventListener('click', cleanup);
	backdrop.addEventListener('click', (event) => {
		if (event.target === backdrop) cleanup();
	});
	doc.addEventListener('keydown', onKeyDown);

	doc.body.appendChild(backdrop);
	doneBtn.focus();
}

/**
 * Starts listening to `beforeinstallprompt` and `appinstalled`. Idempotent.
 */
export function initInstallPrompt(): InstallMode {
	if (typeof window === 'undefined') return 'hidden';
	if (!initialized) {
		initialized = true;

		window.addEventListener('beforeinstallprompt', (event) => {
			event.preventDefault();
			deferredPrompt = event as BeforeInstallPromptEvent;
			notifyListeners();
		});

		window.addEventListener('appinstalled', () => {
			deferredPrompt = null;
			installedInSession = true;
			closeIosInstallGuide();
			notifyListeners();
		});
	}
	return readCurrentMode();
}

/** Subscribes to install mode changes and invokes `listener` immediately. */
export function subscribeInstallMode(listener: ModeListener): () => void {
	const current = initInstallPrompt();
	listeners.add(listener);
	listener(current);
	return () => {
		listeners.delete(listener);
	};
}

/** Triggers native Android/Chromium install prompt or opens the iOS guide. */
export async function triggerInstall(): Promise<InstallTriggerOutcome> {
	if (typeof window === 'undefined' || typeof document === 'undefined') return 'unavailable';
	const mode = initInstallPrompt();

	if (mode === 'prompt' && deferredPrompt) {
		const promptEvent = deferredPrompt;
		deferredPrompt = null;
		try {
			await promptEvent.prompt();
			const choice = await promptEvent.userChoice;
			if (choice.outcome === 'accepted') {
				installedInSession = true;
			}
			notifyListeners();
			return choice.outcome;
		} catch {
			notifyListeners();
			return 'dismissed';
		}
	}

	if (mode === 'ios-guide') {
		showInstallGuide(document, 'ios');
		return 'ios-guide';
	}

	if (mode === 'manual-guide') {
		showInstallGuide(document, 'manual');
		return 'manual-guide';
	}

	return 'unavailable';
}

/**
 * Enhances `[data-pwa-install]` links/buttons on the landing page:
 * - When installable (`prompt` or `ios-guide`), clicking triggers installation directly.
 * - Elements marked `[data-pwa-install-only]` stay hidden unless installable.
 */
export function bindLandingInstallTriggers(): void {
	if (typeof document === 'undefined') return;
	initInstallPrompt();

	const updateVisibility = (mode: InstallMode) => {
		const installable = mode !== 'hidden';
		const onlyNodes = document.querySelectorAll<HTMLElement>('[data-pwa-install-only]');
		onlyNodes.forEach((node) => {
			node.hidden = !installable;
		});
	};

	subscribeInstallMode(updateVisibility);

	const triggers = document.querySelectorAll<HTMLElement>('[data-pwa-install]');
	triggers.forEach((trigger) => {
		if (trigger.dataset.pwaBound === '1') return;
		trigger.dataset.pwaBound = '1';
		trigger.addEventListener('click', (event) => {
			if (readCurrentMode() === 'hidden') return;
			event.preventDefault();
			void triggerInstall();
		});
	});
}
