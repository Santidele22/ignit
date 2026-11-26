import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	cachedEntryCount,
	cachedRead,
	cacheablePath,
	invalidateContentCache,
	setEdgeCacheStore,
	setWaitUntil,
	type EdgeCacheStore,
} from './contentCache';

let now: number;
const nowSource = () => now;

beforeEach(() => {
	now = 1_000_000;
	setWaitUntil(undefined);
	setEdgeCacheStore(undefined);
	invalidateContentCache();
});

const jsonBody = (value: unknown) => () => Promise.resolve(JSON.stringify(value));

describe('cachedRead — cold reads and SWR', () => {
	it('stores the first read and serves it inside the fresh window', async () => {
		const fetcher = vi.fn(jsonBody({ items: [] }));
		const first = await cachedRead('/books', fetcher, { now: nowSource });
		const second = await cachedRead('/books', fetcher, { now: nowSource });
		expect(second).toBe(first);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('serves stale data after TTL and revalidates in background', async () => {
		const fetcher = vi.fn(jsonBody({ v: 1 }));
		await cachedRead('/books', fetcher, { now: nowSource });
		const backgrounds: Promise<unknown>[] = [];
		setWaitUntil((p) => backgrounds.push(p));

		now += 61_000;
		const stale = await cachedRead('/books', jsonBody({ v: 2 }), { now: nowSource });
		expect(stale).toContain('"v":1');
		expect(backgrounds).toHaveLength(1);
		await backgrounds[0];
	});

	it('supports Cloudflare KV L2 cache and invalidation', async () => {
		const map = new Map<string, string>();
		const kv: EdgeCacheStore = {
			get: async (k) => map.get(k) ?? null,
			put: async (k, v) => {
				map.set(k, v);
			},
		};
		setEdgeCacheStore(kv);
		await cachedRead('/books', jsonBody({ v: 1 }), { now: nowSource });
		await invalidateContentCache();
		expect(cachedEntryCount()).toBe(0);
	});
});

describe('cacheablePath — Ignit public catalog whitelist', () => {
	it.each([
		['/books', true],
		['/books?offset=0&limit=8&published=true', true],
		['/books?limit=4&published=true', true],
		['/books/3', true],
		['/books?mine=true', false],
		['/books?offset=8&limit=8&published=true', false],
		['/books/3/reading', false],
		['/books/3/reading-state', false],
		['/books/3/download', false],
		['/books/demo-featured', false],
		['/session-mode', false],
		['/auth/get-session', false],
	])('%s → cacheable=%j', (path, expected) => {
		expect(cacheablePath(path)).toBe(expected);
	});
});
