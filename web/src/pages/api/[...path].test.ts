import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedEntryCount, cachedRead, invalidateContentCache } from '../../shared/api/contentCache';

const envMock = vi.hoisted(() => ({
	backendUrl: 'https://render.example',
	neonAuthUrl: undefined as string | undefined,
	contentCacheKv: undefined,
}));

vi.mock('../../shared/api/serverEnvironment', () => envMock);

const ok = () => Promise.resolve(new Response('{"ok":true}', { status: 200 }));
const notFound = () => Promise.resolve(new Response('{"message":"nope"}', { status: 404 }));

let fetchStub: ReturnType<typeof vi.fn>;

beforeEach(() => {
	envMock.neonAuthUrl = undefined;
	fetchStub = vi.fn(ok);
	vi.stubGlobal('fetch', fetchStub);
	invalidateContentCache();
});

async function call(
	origin: string,
	pathname: string,
	method: string,
	upstream: (input?: unknown) => Promise<Response> = ok,
	headers?: Record<string, string>,
) {
	fetchStub = vi.fn(upstream);
	vi.stubGlobal('fetch', fetchStub);
	const handlers = (await import('./[...path]')) as unknown as {
		[key: string]: (context: unknown) => Promise<Response>;
	};
	return handlers[method]({
		request: new Request(`${origin}${pathname}`, { method, headers }),
		clientAddress: undefined,
	});
}

describe('proxy mutations invalidate the content cache', () => {
	it('drops cached entries after a successful book mutation', async () => {
		await cachedRead('https://render.example/books', async () => '[]');
		expect(cachedEntryCount()).toBe(1);

		await call('https://site.example', '/api/books/1', 'PATCH');
		expect(cachedEntryCount()).toBe(0);
	});

	it('keeps cache when mutation fails or targets auth endpoints', async () => {
		await cachedRead('https://render.example/books', async () => '[]');
		await call('https://site.example', '/api/books/1', 'PATCH', notFound);
		await call('https://site.example', '/api/auth/sign-out', 'POST');
		expect(cachedEntryCount()).toBe(1);
	});

	it('attaches Neon Bearer JWT on GET /api/books/:id/download when cookie is present', async () => {
		envMock.neonAuthUrl = 'https://neon-auth.example';
		const upstream = vi.fn((input: unknown) => {
			if (String(input) === 'https://neon-auth.example/token') {
				return Promise.resolve(new Response(JSON.stringify({ token: 'neon-jwt-42' }), { status: 200 }));
			}
			return Promise.resolve(new Response('pdf-bytes', { status: 200 }));
		});

		const res = await call(
			'https://site.example',
			'/api/books/7/download',
			'GET',
			upstream,
			{ cookie: 'neon.sid=xyz' },
		);

		expect(res.status).toBe(200);
		expect(fetchStub).toHaveBeenCalledTimes(2);
		const backendCall = fetchStub.mock.calls[1] as [string, RequestInit];
		expect(backendCall[0]).toBe('https://render.example/books/7/download');
		const forwardedHeaders = backendCall[1].headers as Headers;
		expect(forwardedHeaders.get('authorization')).toBe('Bearer neon-jwt-42');
	});
});
