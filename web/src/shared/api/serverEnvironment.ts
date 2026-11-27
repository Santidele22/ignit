import { env } from 'cloudflare:workers';
import type { EdgeCacheStore } from './contentCache';

const DEFAULT_LOCAL_BACKEND_URL = 'http://localhost:3000';

export type ServerEnvironmentSources = {
	isDev: boolean;
	workerEnv: {
		BACKEND_URL?: string;
		NEON_AUTH_BASE_URL?: string;
		DATABASE_URL?: string;
		CONTENT_CACHE?: EdgeCacheStore;
	};
	devEnv?: {
		DEV_BACKEND_URL?: string;
		DEV_NEON_AUTH_BASE_URL?: string;
		DEV_DATABASE_URL?: string;
	};
};

function trimTrailingSlashes(value: string | undefined): string | undefined {
	const cleaned = value?.trim().replace(/\/+$/, '');
	return cleaned ? cleaned : undefined;
}

/**
 * Resolves SSR upstream endpoints.
 *
 * In `astro dev`, `@astrojs/cloudflare` loads `wrangler.jsonc` top-level
 * production `vars` (`BACKEND_URL`, `NEON_AUTH_BASE_URL`) into both
 * `cloudflare:workers` and `process.env` / `import.meta.env`. Meanwhile, the
 * Vite dev proxy routes browser `/api` calls to `http://localhost:3000`.
 * Reading `BACKEND_URL` / `NEON_AUTH_BASE_URL` in dev would send SSR session
 * checks to Render/Neon while the browser logs into local dev auth, bouncing
 * `/biblioteca` back to `/login`. In dev mode, default to the local backend
 * with Neon Auth disabled unless explicitly overridden via `DEV_*` vars.
 */
export function resolveServerEnvironment(sources: ServerEnvironmentSources) {
	const rawBackendUrl = sources.isDev
		? sources.devEnv?.DEV_BACKEND_URL || DEFAULT_LOCAL_BACKEND_URL
		: sources.workerEnv.BACKEND_URL || DEFAULT_LOCAL_BACKEND_URL;
	const rawNeonAuthUrl = sources.isDev
		? sources.devEnv?.DEV_NEON_AUTH_BASE_URL
		: sources.workerEnv.NEON_AUTH_BASE_URL;
	const rawDatabaseUrl = sources.isDev
		? sources.devEnv?.DEV_DATABASE_URL
		: sources.workerEnv.DATABASE_URL;

	return {
		backendUrl: trimTrailingSlashes(rawBackendUrl) ?? DEFAULT_LOCAL_BACKEND_URL,
		neonAuthUrl: trimTrailingSlashes(rawNeonAuthUrl),
		databaseUrl: rawDatabaseUrl?.trim() || undefined,
		contentCacheKv: sources.workerEnv.CONTENT_CACHE,
	};
}

const resolved = resolveServerEnvironment({
	isDev: import.meta.env.DEV,
	workerEnv: env as ServerEnvironmentSources['workerEnv'],
	devEnv: {
		DEV_BACKEND_URL: import.meta.env.DEV_BACKEND_URL,
		DEV_NEON_AUTH_BASE_URL: import.meta.env.DEV_NEON_AUTH_BASE_URL,
		DEV_DATABASE_URL: import.meta.env.DEV_DATABASE_URL,
	},
});

export const backendUrl = resolved.backendUrl;
export const neonAuthUrl = resolved.neonAuthUrl;
export const databaseUrl = resolved.databaseUrl;
export const contentCacheKv = resolved.contentCacheKv;
