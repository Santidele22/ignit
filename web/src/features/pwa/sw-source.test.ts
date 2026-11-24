import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
	SW_VERSION,
	SHELL_CACHE_PREFIX,
	RUNTIME_CACHE_PREFIX,
	SHELL_DOCUMENT_PATH,
	cacheNamesFor,
	isCacheableAsset,
	isNavigationForShell,
	shouldBypassCache,
	shouldDeleteCache,
} from './sw-source';

describe('isCacheableAsset', () => {
	it('accepts hashed Astro bundles and self-hosted font assets', () => {
		expect(isCacheableAsset('/_astro/x.css')).toBe(true);
		expect(isCacheableAsset('/_astro/y.js')).toBe(true);
		expect(isCacheableAsset('/fonts/shippori-mincho-400-latin.woff2')).toBe(true);
		expect(isCacheableAsset('/icons/icon-192.png')).toBe(true);
	});

	it('rejects API routes, cross-origin URLs and HTML documents', () => {
		expect(isCacheableAsset('/api/books')).toBe(false);
		expect(isCacheableAsset('https://evil.com/x.js')).toBe(false);
		expect(isCacheableAsset('/biblioteca')).toBe(false);
		expect(isCacheableAsset('/lecturas/123')).toBe(false);
	});
});

describe('isNavigationForShell', () => {
	it('accepts the library and reader routes', () => {
		expect(isNavigationForShell('/biblioteca')).toBe(true);
		expect(isNavigationForShell('/biblioteca/')).toBe(true);
		expect(isNavigationForShell('/lecturas/123')).toBe(true);
	});

	it('rejects unrelated routes', () => {
		expect(isNavigationForShell('/login')).toBe(false);
		expect(isNavigationForShell('/api/x')).toBe(false);
		expect(isNavigationForShell('/')).toBe(false);
		expect(isNavigationForShell('https://evil.com/biblioteca')).toBe(false);
	});
});

describe('cacheNamesFor', () => {
	it('derives distinct stable versioned cache names', () => {
		const names = cacheNamesFor('v1');
		expect(names.shell).toBe(`${SHELL_CACHE_PREFIX}-v1`);
		expect(names.runtime).toBe(`${RUNTIME_CACHE_PREFIX}-v1`);
		expect(names.shell).not.toBe(names.runtime);
		expect(cacheNamesFor('v1')).toEqual(names);
		expect(cacheNamesFor('v2')).not.toEqual(names);
	});

	it('pins the service worker version constant', () => {
		expect(SW_VERSION).toMatch(/^v\d+$/);
		expect(cacheNamesFor(SW_VERSION).shell).toContain(SW_VERSION);
	});

	it('precaches only the library document as the shell', () => {
		expect(SHELL_DOCUMENT_PATH).toBe('/biblioteca');
	});
});

describe('shouldDeleteCache', () => {
	it('deletes stale versions and keeps the current ones', () => {
		const current = cacheNamesFor('v2');
		expect(shouldDeleteCache(cacheNamesFor('v1').shell, 'v2')).toBe(true);
		expect(shouldDeleteCache(cacheNamesFor('v1').runtime, 'v2')).toBe(true);
		expect(shouldDeleteCache(current.shell, 'v2')).toBe(false);
		expect(shouldDeleteCache(current.runtime, 'v2')).toBe(false);
		expect(shouldDeleteCache('some-other-cache', 'v2')).toBe(false);
	});
});

describe('shouldBypassCache', () => {
	it('never caches API routes or cross-origin requests', () => {
		expect(shouldBypassCache('/api/auth/get-session')).toBe(true);
		expect(shouldBypassCache('/api/books')).toBe(true);
		expect(shouldBypassCache('https://evil.com/x.js')).toBe(true);
	});

	it('marks authenticated and non-GET requests as cache bypasses', () => {
		expect(shouldBypassCache('/lecturas/1', { authenticated: true })).toBe(true);
		expect(shouldBypassCache('/_astro/x.css', { method: 'POST' })).toBe(true);
	});

	it('allows same-origin shell navigations and static assets', () => {
		expect(shouldBypassCache('/biblioteca')).toBe(false);
		expect(shouldBypassCache('/lecturas/123', { method: 'GET' })).toBe(false);
		expect(shouldBypassCache('/_astro/x.css', { method: 'GET' })).toBe(false);
	});
});

describe('generated public/sw.js', () => {
	const builtSource = readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8');

	it('is a non-empty classic script', () => {
		expect(builtSource.length).toBeGreaterThan(0);
		expect(builtSource).not.toMatch(/^\s*(import|export)\s/m);
	});

	it('is syntactically valid JavaScript', () => {
		expect(() => new vm.Script(builtSource, { filename: 'sw.js' })).not.toThrow();
	});

	it('ships the shell strategies and the manual update messages', () => {
		expect(builtSource).toContain(SHELL_CACHE_PREFIX);
		expect(builtSource).toContain(RUNTIME_CACHE_PREFIX);
		expect(builtSource).toContain(SHELL_DOCUMENT_PATH);
		expect(builtSource).toContain('SKIP_WAITING');
		expect(builtSource).toContain('CLAIM');
		expect(builtSource).toContain('/api/');
	});
});
