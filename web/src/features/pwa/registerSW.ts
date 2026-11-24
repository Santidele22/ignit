/**
 * Registro del Service Worker de Ignit + aviso discreto de actualización (S2).
 *
 * Se importa desde los dos shells de la app (`BibliotecaApp.onMount` y el
 * `<script>` empaquetado de `LandingHeader.astro`); nunca se auto-ejecuta al
 * importarse, así que ni el SSR ni los tests disparan trabajo de DOM.
 *
 * Reglas que esta unidad respeta:
 * - Sólo se registra `/sw.js` en producción (`import.meta.env.PROD`) y cuando el
 *   navegador expone `navigator.serviceWorker`. En dev nunca hay SW.
 * - `skipWaiting()` no se llama solo: el usuario decide con «Recargar», y la
 *   página recarga una única vez al recibir `controllerchange`.
 * - Todo el DOM se construye con `document.createElement` (nunca `innerHTML`
 *   con datos) y cada acceso a DOM/`navigator` va detrás de un guard, de modo
 *   que el módulo se pueda importar en SSR y en Node sin romper nada.
 *
 * El CSS viaja en su propio archivo (`sw-toast.css`) importado por este módulo:
 * Vite lo empaqueta como hoja y `script-src 'self'` sigue sin hashes nuevos.
 */
import './sw-toast.css';

/** Ruta pública del worker (`scripts/build-sw.mjs` emite `web/public/sw.js`). */
export const SW_PATH = '/sw.js';
/** Alcance explícito: el shell de `/biblioteca` y el lector viven en la raíz. */
export const SW_SCOPE = '/';
/** Texto exacto del aviso (S2). */
export const UPDATE_TOAST_TEXT = 'Nueva versión disponible';
/** Etiqueta exacta del botón (S2). */
export const UPDATE_TOAST_ACTION = 'Recargar';
/** Id del nodo del toast; también permite reemplazarlo en lugar de duplicarlo. */
export const UPDATE_TOAST_ID = 'ignit-sw-toast';
/** Mensaje que `sw-source.ts` interpreta para aplicar la versión nueva. */
export const SKIP_WAITING_MESSAGE = { type: 'SKIP_WAITING' } as const;

export interface RegistrationEnvironment {
	/** `import.meta.env.PROD`: nunca registrar en dev. */
	prod: boolean;
	/** Render en servidor (sin `window`/`navigator`). */
	server: boolean;
	/** `'serviceWorker' in navigator`. */
	hasServiceWorker: boolean;
}

/** Decisión pura de registro: producción + navegador con Service Worker API. */
export function shouldRegisterServiceWorker(environment: RegistrationEnvironment): boolean {
	return environment.prod && !environment.server && environment.hasServiceWorker;
}

/**
 * Estados de `ServiceWorker.state` en los que una versión nueva ya está lista
 * pero retenida: `installed` (recién instalada) y `waiting` (retenida).
 */
export function isUpdateReady(state: string): boolean {
	return state === 'installed' || state === 'waiting';
}

function removeExistingToast(doc: Document): void {
	doc.getElementById(UPDATE_TOAST_ID)?.remove();
}

/**
 * Pinta el toast fijo. El nodo contenedor (`role="status"`, `aria-live="polite"`)
 * se inserta primero y su contenido entra en el frame siguiente: así los
 * lectores de pantalla anuncian la mutación del live region, no el montaje.
 */
function showUpdateToast(doc: Document, registration: ServiceWorkerRegistration): void {
	removeExistingToast(doc);

	const container = doc.createElement('div');
	container.id = UPDATE_TOAST_ID;
	container.className = 'sw-toast';
	container.setAttribute('role', 'status');
	container.setAttribute('aria-live', 'polite');
	container.setAttribute('aria-atomic', 'true');

	const message = doc.createElement('p');
	message.className = 'sw-toast-text';
	message.textContent = UPDATE_TOAST_TEXT;

	const action = doc.createElement('button');
	action.type = 'button';
	action.className = 'sw-toast-action';
	action.textContent = UPDATE_TOAST_ACTION;
	action.addEventListener('click', () => {
		const waiting = registration.waiting ?? registration.installing;
		action.disabled = true;
		if (!waiting) {
			// Already activating: a reload is the only thing left to do.
			window.location.reload();
			return;
		}
		waiting.postMessage(SKIP_WAITING_MESSAGE);
	});

	doc.body.appendChild(container);

	// `appendChild` (not `append`): the Cloudflare HTMLRewriter `Element` interface
	// merges into the global DOM `Element` in this project's types and breaks the
	// `append(...nodes)` overload resolution.
	const reveal = () => {
		container.appendChild(message);
		container.appendChild(action);
	};
	if (typeof window.requestAnimationFrame === 'function') {
		window.requestAnimationFrame(reveal);
	} else {
		reveal();
	}
}

let registrationStarted = false;
let reloadRequested = false;

/**
 * Registra `/sw.js` (producción, navegador con Service Worker API) y cablea el
 * aviso de actualización. Idempotente: devuelve `true` si el registro está en
 * marcha y `false` cuando la unidad no aplica (SSR, dev, navegador sin soporte).
 */
export function registerServiceWorker(): boolean {
	if (typeof window === 'undefined' || typeof document === 'undefined') return false;
	if (typeof navigator === 'undefined') return false;

	const hasServiceWorker = 'serviceWorker' in navigator;
	const environment: RegistrationEnvironment = {
		prod: import.meta.env.PROD,
		server: false,
		hasServiceWorker,
	};
	if (!shouldRegisterServiceWorker(environment)) return false;
	if (registrationStarted) return true;
	registrationStarted = true;

	const container = navigator.serviceWorker;

	container.addEventListener('controllerchange', () => {
		// Reload exactly once: several workers can announce `controllerchange`.
		if (reloadRequested) return;
		reloadRequested = true;
		window.location.reload();
	});

	void container
		.register(SW_PATH, { scope: SW_SCOPE })
		.then((registration) => {
			// A worker already waiting when the page loads is an update too.
			if (registration.waiting && container.controller) {
				showUpdateToast(document, registration);
			}

			registration.addEventListener('updatefound', () => {
				const installing = registration.installing;
				if (!installing) return;

				installing.addEventListener('statechange', () => {
					if (!isUpdateReady(installing.state)) return;
					// Without a controller this is the first install, not an update.
					if (!container.controller) return;
					showUpdateToast(document, registration);
				});
			});
		})
		.catch(() => {
			// Registration is best effort: a failure must never break the shell.
		});

	return true;
}
