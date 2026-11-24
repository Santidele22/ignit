import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	SKIP_WAITING_MESSAGE,
	SW_PATH,
	SW_SCOPE,
	UPDATE_TOAST_ACTION,
	UPDATE_TOAST_TEXT,
	isUpdateReady,
	registerServiceWorker,
	shouldRegisterServiceWorker,
} from './registerSW';

const toastCss = readFileSync(new URL('./sw-toast.css', import.meta.url), 'utf8');
const moduleSource = readFileSync(new URL('./registerSW.ts', import.meta.url), 'utf8');

describe('shouldRegisterServiceWorker', () => {
	it('registers only in a production browser with Service Worker support', () => {
		expect(shouldRegisterServiceWorker({ prod: true, server: false, hasServiceWorker: true })).toBe(
			true,
		);
	});

	it('never registers in dev (S2: no service worker in development)', () => {
		expect(shouldRegisterServiceWorker({ prod: false, server: false, hasServiceWorker: true })).toBe(
			false,
		);
	});

	it('never registers without `serviceWorker` in navigator', () => {
		expect(shouldRegisterServiceWorker({ prod: true, server: false, hasServiceWorker: false })).toBe(
			false,
		);
	});

	it('never registers during SSR', () => {
		expect(shouldRegisterServiceWorker({ prod: true, server: true, hasServiceWorker: true })).toBe(
			false,
		);
	});
});

describe('isUpdateReady', () => {
	it('accepts the two installed-and-waiting states of a new worker', () => {
		expect(isUpdateReady('installed')).toBe(true);
		expect(isUpdateReady('waiting')).toBe(true);
	});

	it('rejects installing, activating and redundant workers', () => {
		expect(isUpdateReady('installing')).toBe(false);
		expect(isUpdateReady('activating')).toBe(false);
		expect(isUpdateReady('redundant')).toBe(false);
		expect(isUpdateReady('parsed')).toBe(false);
	});
});

describe('update toast copy', () => {
	it('exposes the exact toast strings and postMessage payload', () => {
		expect(UPDATE_TOAST_TEXT).toBe('Nueva versión disponible');
		expect(UPDATE_TOAST_ACTION).toBe('Recargar');
		expect(SKIP_WAITING_MESSAGE).toEqual({ type: 'SKIP_WAITING' });
		expect(SW_PATH).toBe('/sw.js');
		expect(SW_SCOPE).toBe('/');
	});

	it('positions the toast above the safe area, bottom-right', () => {
		expect(toastCss).toMatch(/position:\s*fixed;/);
		expect(toastCss).toContain('bottom: calc(16px + env(safe-area-inset-bottom));');
		expect(toastCss).toContain('env(safe-area-inset-right)');
	});

	it('meets the 44px touch target and noche-azul palette tokens', () => {
		expect(toastCss).toContain('min-height: 44px;');
		expect(toastCss).toContain('min-width: 44px;');
		expect(toastCss).toContain('#060810');
		expect(toastCss).toContain('#232941');
		expect(toastCss).toContain('#5f86c9');
		expect(toastCss).toMatch(/font-family: var\(--font-geist-mono/);
	});

	it('builds the toast with createElement only and guards every DOM access', () => {
		expect(moduleSource).not.toMatch(/\.innerHTML/);
		expect(moduleSource).not.toContain('insertAdjacentHTML');
		expect(moduleSource).toContain('document.createElement');
		expect(moduleSource).toContain("typeof window === 'undefined'");
		expect(moduleSource).toContain('aria-live');
	});
});

describe('registerServiceWorker outside a browser', () => {
	it('imports cleanly and no-ops without `window` (SSR / Node)', () => {
		expect(typeof registerServiceWorker).toBe('function');
		expect(registerServiceWorker()).toBe(false);
	});
});
