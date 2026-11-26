/**
 * Window A (08:00-02:00 ART = 11-23,0-4 UTC): pings `/session-mode` every 10 min
 * so Render Free stays awake 18h/day (~549/750h/mo) with 0 Neon CU-h consumed.
 */
export const RENDER_KEEP_ALIVE_CRON = '*/10 11-23,0-4 * * *';

/**
 * Window B (12:00-00:00 ART = 15-23,0-2 UTC): pings `/health-db` every 4 min
 * so Neon Free stays warm during the 12 peak hours (~91/100 CU-h/mo).
 */
export const NEON_PEAK_KEEP_ALIVE_CRON = '*/4 15-23,0-2 * * *';

export type PingPath = '/health-db' | '/session-mode';

export interface PingOptions {
	path?: PingPath;
	maxAttempts?: number;
	retryDelayMs?: number;
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
	sleepImpl?: (ms: number) => Promise<void>;
}

export interface PingResult {
	ok: boolean;
	status: number | null;
	url: string;
	attempts: number;
	durationMs: number;
	error?: string;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 25_000;

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolvePingPath(cron?: string): PingPath {
	return cron === NEON_PEAK_KEEP_ALIVE_CRON ? '/health-db' : '/session-mode';
}

export async function pingBackend(backendUrl: string, options: PingOptions = {}): Promise<PingResult> {
	const base = backendUrl.trim().replace(/\/+$/, '');
	const path = options.path ?? '/session-mode';
	const url = `${base}${path}`;
	const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
	const retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
	const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const fetchImpl = options.fetchImpl ?? fetch;
	const sleepImpl = options.sleepImpl ?? defaultSleep;

	const startedAt = Date.now();
	let lastStatus: number | null = null;
	let lastError: string | undefined;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const response = await fetchImpl(url, {
				method: 'GET',
				headers: {
					'cache-control': 'no-store',
					'user-agent': 'ignit-keep-alive/1.0',
				},
				signal: AbortSignal.timeout(timeoutMs),
			});
			lastStatus = response.status;
			// Drain or cancel body so Cloudflare Workers never leaks connections.
			await response.body?.cancel().catch(() => {});

			if (response.ok) {
				return {
					ok: true,
					status: response.status,
					url,
					attempts: attempt,
					durationMs: Date.now() - startedAt,
				};
			}

			lastError = `HTTP ${response.status}`;
			if (response.status >= 400 && response.status < 500) {
				return {
					ok: false,
					status: response.status,
					url,
					attempts: attempt,
					durationMs: Date.now() - startedAt,
					error: lastError,
				};
			}
		} catch (error) {
			lastStatus = null;
			lastError = error instanceof Error ? error.message : String(error);
		}

		if (attempt < maxAttempts && retryDelayMs > 0) {
			await sleepImpl(retryDelayMs * attempt);
		}
	}

	return {
		ok: false,
		status: lastStatus,
		url,
		attempts: maxAttempts,
		durationMs: Date.now() - startedAt,
		error: lastError,
	};
}
