import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateContentCache } from './contentCache';
import { getJson, postJsonReturning, resolveApiUrl, SSR_READ_TIMEOUT_MS } from './http';

vi.mock('./serverEnvironment', () => ({ backendUrl: 'https://render.example', neonAuthUrl: undefined }));

const jsonResponse = (body: unknown) =>
	new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

let fetchStub: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchStub = vi.fn(() => Promise.resolve(jsonResponse({ ok: 1 })));
	vi.stubGlobal('fetch', fetchStub);
	invalidateContentCache();
	import.meta.env.SSR = true;
});

afterEach(() => {
	vi.unstubAllGlobals();
	import.meta.env.SSR = false;
});

describe('getJson — SSR caching and timeouts', () => {
	it('caches public /books reads during SSR and bounds timeout to 20s', async () => {
		const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
		await getJson('/books');
		await getJson('/books');

		expect(fetchStub).toHaveBeenCalledTimes(1);
		expect(SSR_READ_TIMEOUT_MS).toBe(20_000);
		expect(timeoutSpy).toHaveBeenCalledWith(20_000);
	});

	it('never caches authenticated, cookie, mine=true, or reading-state reads', async () => {
		await getJson('/books?mine=true', { bearerToken: 'jwt' });
		await getJson('/books?mine=true', { bearerToken: 'jwt' });
		await getJson('/books/7', { cookie: 'session=abc' });
		await getJson('/books/7', { cookie: 'session=abc' });

		expect(fetchStub).toHaveBeenCalledTimes(4);
	});

	it('resolves backend URLs in SSR and /api proxy URLs in browser', async () => {
		import.meta.env.SSR = true;
		await expect(resolveApiUrl('/books')).resolves.toBe('https://render.example/books');
		import.meta.env.SSR = false;
		await expect(resolveApiUrl('/books')).resolves.toBe('/api/books');
	});

	it('returns created payload on postJsonReturning and preserves API errors', async () => {
		fetchStub.mockImplementationOnce(() => Promise.resolve(jsonResponse({ id: 9 })));
		await expect(postJsonReturning<{ id: number }>('/books', { title: 'Dune' })).resolves.toEqual({ id: 9 });
	});
});
