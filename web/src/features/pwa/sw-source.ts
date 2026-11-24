/**
 * Source of the Ignit service worker.
 *
 * Bundled to `public/sw.js` by `scripts/build-sw.mjs` (classic IIFE script, so
 * Safari and older browsers accept it). The decision helpers below are pure so
 * they can be unit-tested in Node; the event wiring lives in `main()` and only
 * runs inside a `ServiceWorkerGlobalScope`.
 *
 * Reading data keeps living in IndexedDB (`features/library/lib/offlineStore.ts`):
 * the service worker only caches documents and static assets.
 *
 * The repo type-checks against the Cloudflare worker runtime types, where
 * `ServiceWorkerGlobalScope` is an interface without the browser-only members we
 * need (`addEventListener` typings, `clients`, `skipWaiting`). The small local
 * interfaces below model exactly the surface this file uses.
 */

export const SW_VERSION = 'v1';
export const SHELL_CACHE_PREFIX = 'ignit-shell';
export const RUNTIME_CACHE_PREFIX = 'ignit-runtime';
export const SHELL_DOCUMENT_PATH = '/biblioteca';

export interface ServiceWorkerLifecycleEvent {
	waitUntil(promise: Promise<unknown>): void;
}

export interface ServiceWorkerFetchEvent {
	readonly request: Request;
	respondWith(response: Response | Promise<Response>): void;
}

export interface ServiceWorkerMessageEvent {
	readonly data: unknown;
	waitUntil?(promise: Promise<unknown>): void;
}

export interface ServiceWorkerScope {
	readonly clients: { claim(): Promise<void> };
	skipWaiting(): Promise<void>;
	addEventListener(type: 'install' | 'activate', listener: (event: ServiceWorkerLifecycleEvent) => void): void;
	addEventListener(type: 'fetch', listener: (event: ServiceWorkerFetchEvent) => void): void;
	addEventListener(type: 'message', listener: (event: ServiceWorkerMessageEvent) => void): void;
}

/** Origin used when the helpers run outside a service worker (unit tests). */
const FALLBACK_ORIGIN = 'https://ignit.invalid';

const SELF_HOSTED_ASSET_ROOTS = ['/_astro/', '/fonts/', '/icons/', '/images/', '/assets/'];

const ASSET_EXTENSIONS = [
	'.css',
	'.js',
	'.mjs',
	'.woff',
	'.woff2',
	'.ttf',
	'.otf',
	'.eot',
	'.png',
	'.jpg',
	'.jpeg',
	'.webp',
	'.avif',
	'.svg',
	'.gif',
	'.ico',
];

export interface CacheNames {
	shell: string;
	runtime: string;
}

export interface CacheDecisionOptions {
	method?: string;
	authenticated?: boolean;
}

function currentOrigin(): string {
	if (typeof self !== 'undefined') {
		const location = (self as { location?: { origin?: string } }).location;
		if (location && typeof location.origin === 'string' && location.origin && location.origin !== 'null') {
			return location.origin;
		}
	}
	return FALLBACK_ORIGIN;
}

function resolveUrl(input: string | URL): URL | null {
	if (input instanceof URL) return input;
	if (typeof input !== 'string' || input.length === 0) return null;
	try {
		return new URL(input, currentOrigin());
	} catch {
		return null;
	}
}

function isSameOrigin(url: URL): boolean {
	return url.origin === currentOrigin();
}

function isApiPath(pathname: string): boolean {
	return pathname === '/api' || pathname.startsWith('/api/');
}

function hasAssetExtension(pathname: string): boolean {
	const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1).toLowerCase();
	const dot = lastSegment.lastIndexOf('.');
	if (dot <= 0) return false;
	return ASSET_EXTENSIONS.includes(lastSegment.slice(dot));
}

export function cacheNamesFor(version: string): CacheNames {
	return {
		shell: `${SHELL_CACHE_PREFIX}-${version}`,
		runtime: `${RUNTIME_CACHE_PREFIX}-${version}`,
	};
}

/** True for caches this service worker manages that belong to an older version. */
export function shouldDeleteCache(cacheName: string, version: string): boolean {
	const names = cacheNamesFor(version);
	const managed =
		cacheName.startsWith(`${SHELL_CACHE_PREFIX}-`) || cacheName.startsWith(`${RUNTIME_CACHE_PREFIX}-`);
	return managed && cacheName !== names.shell && cacheName !== names.runtime;
}

/** True for same-origin static assets: hashed `/_astro/*` bundles plus self-hosted fonts/images. */
export function isCacheableAsset(input: string | URL): boolean {
	const url = resolveUrl(input);
	if (!url) return false;
	if (!isSameOrigin(url)) return false;
	const pathname = url.pathname;
	if (isApiPath(pathname)) return false;
	if (pathname.startsWith('/_astro/')) return true;
	if (!hasAssetExtension(pathname)) return false;
	return SELF_HOSTED_ASSET_ROOTS.some((root) => pathname.startsWith(root));
}

/** True for the app-shell documents: `/biblioteca` and the reader route skeleton. */
export function isNavigationForShell(input: string | URL): boolean {
	const url = resolveUrl(input);
	if (!url) return false;
	if (!isSameOrigin(url)) return false;
	const pathname = url.pathname;
	return (
		pathname === SHELL_DOCUMENT_PATH ||
		pathname.startsWith(`${SHELL_DOCUMENT_PATH}/`) ||
		pathname.startsWith('/lecturas/')
	);
}

/**
 * True when the request must go straight to the network: non-GET methods,
 * `/api/*` (session and auth), cross-origin URLs, and anything the caller marks
 * as authenticated.
 */
export function shouldBypassCache(input: string | URL, options: CacheDecisionOptions = {}): boolean {
	const { method = 'GET', authenticated = false } = options;
	if (method.toUpperCase() !== 'GET') return true;
	if (authenticated) return true;
	const url = resolveUrl(input);
	if (!url) return true;
	if (!isSameOrigin(url)) return true;
	return isApiPath(url.pathname);
}

function isCacheableDocumentResponse(response: Response): boolean {
	if (!response.ok) return false;
	if (response.type === 'opaqueredirect' || response.type === 'opaque') return false;
	// A redirected document means the auth gate answered with the login page.
	if (response.redirected) return false;
	const contentType = response.headers.get('content-type') ?? '';
	return contentType.includes('text/html');
}

function isCacheableAssetResponse(response: Response): boolean {
	return response.ok && (response.type === 'basic' || response.type === 'default' || response.type === 'cors');
}

function offlineDocument(): Response {
	const body =
		'<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Sin conexión · Ignit</title></head>' +
		'<body><p>Sin conexión. Abre la biblioteca cuando recuperes la señal.</p></body></html>';
	return new Response(body, {
		status: 503,
		statusText: 'Service Unavailable',
		headers: { 'content-type': 'text/html; charset=utf-8' },
	});
}

async function precacheShell(): Promise<void> {
	const names = cacheNamesFor(SW_VERSION);
	const cache = await caches.open(names.shell);
	const cached = await cache.match(SHELL_DOCUMENT_PATH);
	if (cached) return;
	try {
		const response = await fetch(new Request(SHELL_DOCUMENT_PATH, { credentials: 'same-origin' }));
		if (isCacheableDocumentResponse(response)) {
			await cache.put(SHELL_DOCUMENT_PATH, response.clone());
		}
	} catch {
		// Offline install (or an auth-gated shell): keep the worker installable and
		// let the next navigation cache the shell.
	}
}

async function deleteStaleCaches(): Promise<void> {
	const keys = await caches.keys();
	const stale = keys.filter((name) => shouldDeleteCache(name, SW_VERSION));
	await Promise.all(stale.map((name) => caches.delete(name)));
}

async function handleShellNavigation(request: Request): Promise<Response> {
	const names = cacheNamesFor(SW_VERSION);
	const cache = await caches.open(names.shell);
	try {
		const response = await fetch(request);
		if (isCacheableDocumentResponse(response)) {
			await cache.put(request, response.clone());
		}
		return response;
	} catch {
		const cached = await cache.match(request, { ignoreSearch: true });
		if (cached) return cached;
		const shell = await cache.match(SHELL_DOCUMENT_PATH);
		if (shell) return shell;
		return offlineDocument();
	}
}

async function staleWhileRevalidate(request: Request): Promise<Response> {
	const names = cacheNamesFor(SW_VERSION);
	const cache = await caches.open(names.runtime);
	const cached = await cache.match(request);
	const revalidate = fetch(request)
		.then(async (response) => {
			if (isCacheableAssetResponse(response)) {
				await cache.put(request, response.clone());
			}
			return response;
		})
		.catch(() => undefined);

	if (cached) {
		void revalidate;
		return cached;
	}

	const fresh = await revalidate;
	return fresh ?? new Response('', { status: 504, statusText: 'Gateway Timeout' });
}

function handleMessage(scope: ServiceWorkerScope, event: ServiceWorkerMessageEvent): void {
	const data = event.data as unknown;
	if (!data || typeof data !== 'object') return;
	const type = (data as { type?: unknown }).type;
	if (type === 'SKIP_WAITING') {
		void scope.skipWaiting();
		return;
	}
	if (type === 'CLAIM') {
		const claim = scope.clients.claim();
		if (typeof event.waitUntil === 'function') {
			event.waitUntil(claim);
		}
	}
}

function registerHandlers(scope: ServiceWorkerScope): void {
	scope.addEventListener('install', (event) => {
		// No automatic skipWaiting: the page decides when to apply the update.
		event.waitUntil(precacheShell());
	});

	scope.addEventListener('activate', (event) => {
		// No automatic clients.claim(): an open page keeps its worker until it asks.
		event.waitUntil(deleteStaleCaches());
	});

	scope.addEventListener('fetch', (event) => {
		const request = event.request;
		const url = request.url;
		// Bypass without respondWith so the browser handles API and non-GET traffic.
		if (shouldBypassCache(url, { method: request.method })) return;

		if (request.mode === 'navigate') {
			if (isNavigationForShell(url)) {
				event.respondWith(handleShellNavigation(request));
			}
			return;
		}

		if (isCacheableAsset(url)) {
			event.respondWith(staleWhileRevalidate(request));
		}
	});

	scope.addEventListener('message', (event) => {
		handleMessage(scope, event);
	});
}

/** Resolves the current global as a service worker scope, or `null` anywhere else. */
export function resolveServiceWorkerScope(): ServiceWorkerScope | null {
	if (typeof self === 'undefined') return null;
	const ctor = (globalThis as unknown as { ServiceWorkerGlobalScope?: unknown }).ServiceWorkerGlobalScope;
	if (typeof ctor !== 'function') return null;
	if (!(self instanceof (ctor as new () => object))) return null;
	return self as unknown as ServiceWorkerScope;
}

/** Wires the service worker events. No-op outside a service worker. */
export function main(scope: ServiceWorkerScope | null = null): void {
	const target = scope ?? resolveServiceWorkerScope();
	if (!target) return;
	registerHandlers(target);
}

if (typeof self !== 'undefined') {
	main();
}
