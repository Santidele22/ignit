import { describe, expect, it, vi } from 'vitest';
import {
	NEON_PEAK_KEEP_ALIVE_CRON,
	RENDER_KEEP_ALIVE_CRON,
	pingBackend,
	resolvePingPath,
} from './ping';
import worker from './index';

describe('resolvePingPath', () => {
	it('routes the 12h Neon peak cron to /health-db', () => {
		expect(resolvePingPath(NEON_PEAK_KEEP_ALIVE_CRON)).toBe('/health-db');
	});

	it('routes the 18h Render cron and unknown crons to /session-mode', () => {
		expect(resolvePingPath(RENDER_KEEP_ALIVE_CRON)).toBe('/session-mode');
		expect(resolvePingPath(undefined)).toBe('/session-mode');
		expect(resolvePingPath('*/15 * * * *')).toBe('/session-mode');
	});
});

describe('pingBackend', () => {
	const instantSleep = vi.fn(async () => {});

	it('succeeds on the first 200 OK without retrying and strips trailing slashes', async () => {
		const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));

		const result = await pingBackend('https://ignit-api.example///', {
			path: '/health-db',
			fetchImpl,
			sleepImpl: instantSleep,
		});

		expect(result.ok).toBe(true);
		expect(result.status).toBe(200);
		expect(result.url).toBe('https://ignit-api.example/health-db');
		expect(result.attempts).toBe(1);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('retries on 502/network errors up to maxAttempts and recovers when backend wakes', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }))
			.mockRejectedValueOnce(new Error('timeout'))
			.mockResolvedValueOnce(new Response('{"mode":"neon"}', { status: 200 }));

		const result = await pingBackend('https://ignit-api.example', {
			path: '/session-mode',
			maxAttempts: 3,
			retryDelayMs: 10,
			fetchImpl,
			sleepImpl: instantSleep,
		});

		expect(result.ok).toBe(true);
		expect(result.status).toBe(200);
		expect(result.attempts).toBe(3);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});

	it('does not retry on 4xx client errors', async () => {
		const fetchImpl = vi.fn(async () => new Response('Not Found', { status: 404 }));

		const result = await pingBackend('https://ignit-api.example', {
			path: '/session-mode',
			maxAttempts: 3,
			fetchImpl,
			sleepImpl: instantSleep,
		});

		expect(result.ok).toBe(false);
		expect(result.status).toBe(404);
		expect(result.attempts).toBe(1);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('returns ok=false cleanly after exhausting retries without throwing', async () => {
		const fetchImpl = vi.fn(async () => new Response('Bad Gateway', { status: 502 }));

		const result = await pingBackend('https://ignit-api.example', {
			path: '/health-db',
			maxAttempts: 2,
			fetchImpl,
			sleepImpl: instantSleep,
		});

		expect(result.ok).toBe(false);
		expect(result.status).toBe(502);
		expect(result.attempts).toBe(2);
	});
});

describe('scheduled worker handler', () => {
	it('dispatches /health-db for the Neon peak cron via ctx.waitUntil', async () => {
		const fetchSpy = vi.fn(async (_input: unknown, _init?: unknown) => new Response('{"ok":true}', { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);

		const tasks: Promise<unknown>[] = [];
		const ctx = {
			waitUntil: (promise: Promise<unknown>) => {
				tasks.push(promise);
			},
		} as unknown as ExecutionContext;

		await worker.scheduled(
			{ cron: NEON_PEAK_KEEP_ALIVE_CRON, scheduledTime: Date.now() } as ScheduledController,
			{ BACKEND_URL: 'https://ignit-api-ohm4.onrender.com' },
			ctx,
		);
		await Promise.all(tasks);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://ignit-api-ohm4.onrender.com/health-db');
		vi.unstubAllGlobals();
	});

	it('returns 404 on public HTTP fetch requests', async () => {
		const res = await worker.fetch();
		expect(res.status).toBe(404);
	});
});
