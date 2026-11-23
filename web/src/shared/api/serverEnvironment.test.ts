import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EdgeCacheStore } from './contentCache';

const workerEnv = vi.hoisted(() => ({
	BACKEND_URL: 'https://ignit-api-ohm4.onrender.com/',
	NEON_AUTH_BASE_URL: 'https://neon.example/neondb/auth/',
	CONTENT_CACHE: undefined as EdgeCacheStore | undefined,
}));

vi.mock('cloudflare:workers', () => ({ env: workerEnv }));

describe('serverEnvironment', () => {
	const originalDev = import.meta.env.DEV;

	beforeEach(() => {
		vi.resetModules();
		workerEnv.BACKEND_URL = 'https://ignit-api-ohm4.onrender.com/';
		workerEnv.NEON_AUTH_BASE_URL = 'https://neon.example/neondb/auth/';
		workerEnv.CONTENT_CACHE = undefined;
	});

	afterEach(() => {
		import.meta.env.DEV = originalDev;
	});

	it('defaults to local backend and disables Neon Auth in dev even when wrangler vars point to production', async () => {
		import.meta.env.DEV = true;
		const mod = await import('./serverEnvironment');

		expect(mod.backendUrl).toBe('http://localhost:3000');
		expect(mod.neonAuthUrl).toBeUndefined();
	});

	it('respects explicit DEV_* overrides when provided to resolveServerEnvironment', async () => {
		const { resolveServerEnvironment } = await import('./serverEnvironment');

		expect(
			resolveServerEnvironment({
				isDev: true,
				workerEnv,
				devEnv: {
					DEV_BACKEND_URL: 'http://localhost:3100/',
					DEV_NEON_AUTH_BASE_URL: 'https://dev-neon.example/auth/',
				},
			}),
		).toEqual({
			backendUrl: 'http://localhost:3100',
			neonAuthUrl: 'https://dev-neon.example/auth',
			contentCacheKv: undefined,
		});
	});

	it('uses Cloudflare worker vars in production mode and trims trailing slashes', async () => {
		const cacheBinding = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
		const { resolveServerEnvironment } = await import('./serverEnvironment');

		expect(
			resolveServerEnvironment({
				isDev: false,
				workerEnv: {
					BACKEND_URL: 'https://ignit-api-ohm4.onrender.com///',
					NEON_AUTH_BASE_URL: 'https://neon.example/neondb/auth/',
					CONTENT_CACHE: cacheBinding as never,
				},
			}),
		).toEqual({
			backendUrl: 'https://ignit-api-ohm4.onrender.com',
			neonAuthUrl: 'https://neon.example/neondb/auth',
			contentCacheKv: cacheBinding,
		});
	});

	it('falls back to localhost and undefined neonAuthUrl in production when worker vars are empty', async () => {
		const { resolveServerEnvironment } = await import('./serverEnvironment');

		expect(
			resolveServerEnvironment({
				isDev: false,
				workerEnv: {
					BACKEND_URL: '',
					NEON_AUTH_BASE_URL: '',
				},
			}),
		).toEqual({
			backendUrl: 'http://localhost:3000',
			neonAuthUrl: undefined,
			contentCacheKv: undefined,
		});
	});
});
