import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedEntryCount, cachedRead, invalidateContentCache } from '../../shared/api/contentCache';

vi.mock('../../shared/api/serverEnvironment', () => ({
	backendUrl: 'https://render.example',
	neonAuthUrl: undefined,
	contentCacheKv: undefined,
}));

const ok = () => Promise.resolve(new Response('{"ok":true}', { status: 200 }));
const notFound = () => Promise.resolve(new Response('{"message":"nope"}', { status: 404 }));

let fetchStub: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchStub = vi.fn(ok);
	vi.stubGlobal('fetch', fetchStub);
	invalidateContentCache();
});

async function call(origin: string, pathname: string, method: string, upstream = ok) {
	fetchStub = vi.fn(upstream);
	vi.stubGlobal('fetch', fetchStub);
	const handlers = (await import('./[...path]')) as unknown as {
		[key: string]: (context: unknown) => Promise<Response>;
	};
	return handlers[method]({
		request: new Request(`${origin}${pathname}`, { method }),
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
});
