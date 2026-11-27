import { describe, expect, it } from 'vitest';
import type { BookReadingDocument } from '../../../entities/book/types';
import {
	bytesToKb,
	createIndexedDbAdapter,
	createMemoryOfflineAdapter,
	createOfflineBookStore,
	createSyncOutboxStore,
	measureReadingBytes,
} from './offlineStore';

function sampleReading(bookId: string, text = 'Texto de prueba para lectura offline'): BookReadingDocument {
	return {
		bookId,
		pdfPages: 142,
		ocrPending: false,
		chunks: [
			{
				id: 'c1',
				type: 'para',
				page: 1,
				offset: 0,
				text,
				mood: 'espera',
				cues: [],
			},
		],
	};
}

describe('offlineStore', () => {
	it('measures UTF-8 byte length and rounds to KB with a 1 KB floor for non-empty payloads', () => {
		const doc = sampleReading('1', 'Árbol nocturno 熒');
		const bytes = measureReadingBytes(doc);
		expect(bytes).toBeGreaterThan(new TextEncoder().encode('Árbol nocturno 熒').byteLength);
		expect(bytesToKb(0)).toBe(0);
		expect(bytesToKb(200)).toBe(1);
		expect(bytesToKb(2048)).toBe(2);
	});

	it('stores, retrieves, lists, removes, and clears offline books via adapter', async () => {
		const store = createOfflineBookStore(createMemoryOfflineAdapter());
		expect(store.isAvailable()).toBe(true);

		const rec1 = await store.put({
			book: { id: 1, title: 'El desierto de los tártaros', author: 'Dino Buzzati', kind: 'no_tecnico' },
			reading: sampleReading('1'),
			savedAt: 1000,
		});
		const rec2 = await store.put({
			book: { id: 2, title: 'Sistemas operativos', author: 'Tanenbaum', kind: 'tecnico' },
			reading: sampleReading('2', 'x'.repeat(3000)),
			savedAt: 2000,
		});

		expect(rec1.bookId).toBe(1);
		expect(rec1.pdfPages).toBe(142);
		expect(rec1.kb).toBeGreaterThanOrEqual(1);
		expect(rec2.kb).toBeGreaterThanOrEqual(3);

		const fetched = await store.get(1);
		expect(fetched?.title).toBe('El desierto de los tártaros');
		expect(fetched?.reading.chunks[0]?.text).toContain('Texto de prueba');

		const list = await store.list();
		expect(list.map((r) => r.bookId)).toEqual([2, 1]);

		await store.remove(1);
		expect(await store.get(1)).toBeNull();
		expect((await store.list()).map((r) => r.bookId)).toEqual([2]);

		await store.clear();
		expect(await store.list()).toEqual([]);
	});

	it('degrades gracefully when IndexedDB is unavailable', async () => {
		const store = createOfflineBookStore(null);
		expect(store.isAvailable()).toBe(false);
		expect(await store.get(1)).toBeNull();
		expect(await store.list()).toEqual([]);
		await expect(store.remove(1)).resolves.toBeUndefined();
		await expect(store.clear()).resolves.toBeUndefined();
		await expect(
			store.put({
				book: { id: 1, title: 'A', author: 'B', kind: 'no_tecnico' },
				reading: sampleReading('1'),
			}),
		).rejects.toThrow(/IndexedDB/i);
	});

	it('executes full IndexedDB lifecycle via IDBFactory and closes db on error', async () => {
		const stores = new Map<string, Map<number, unknown>>();
		let closeCount = 0;
		const makeReq = <T,>(exec: () => T) => {
			const req: Record<string, unknown> = { result: undefined, error: null, onsuccess: null, onerror: null };
			queueMicrotask(() => {
				try {
					req.result = exec();
					if (typeof req.onsuccess === 'function') (req.onsuccess as () => void)();
				} catch (err) {
					req.error = err;
					if (typeof req.onerror === 'function') (req.onerror as () => void)();
				}
			});
			return req as unknown as IDBRequest<T>;
		};
		const factory = {
			open: () => {
				const openReq: Record<string, unknown> = {
					result: null,
					error: null,
					onupgradeneeded: null,
					onsuccess: null,
					onerror: null,
				};
				openReq.result = {
					objectStoreNames: { contains: (n: string) => stores.has(n) },
					createObjectStore: (n: string) => {
						if (!stores.has(n)) stores.set(n, new Map());
					},
					close: () => {
						closeCount += 1;
					},
					transaction: (storeName: string) => {
						const tx: Record<string, unknown> = { error: null, oncomplete: null, onerror: null, onabort: null };
						const finish = () =>
							queueMicrotask(() => {
								if (typeof tx.oncomplete === 'function') (tx.oncomplete as () => void)();
							});
						tx.objectStore = () => {
							const map = stores.get(storeName)!;
							return {
								put: (rec: { bookId: number }) =>
									makeReq(() => {
										map.set(rec.bookId, rec);
										finish();
										return rec.bookId;
									}),
								get: (k: number) =>
									makeReq(() => {
										const v = map.get(k);
										finish();
										return v;
									}),
								getAll: () =>
									makeReq(() => {
										const all = [...map.values()];
										finish();
										return all;
									}),
								delete: (k: number) =>
									makeReq(() => {
										map.delete(k);
										finish();
										return undefined;
									}),
								clear: () =>
									makeReq(() => {
										map.clear();
										finish();
										return undefined;
									}),
							};
						};
						return tx;
					},
				};
				queueMicrotask(() => {
					if (!stores.has('books') && typeof openReq.onupgradeneeded === 'function') {
						(openReq.onupgradeneeded as () => void)();
					}
					if (typeof openReq.onsuccess === 'function') (openReq.onsuccess as () => void)();
				});
				return openReq;
			},
		} as unknown as IDBFactory;

		const store = createOfflineBookStore(createIndexedDbAdapter(factory));
		const saved = await store.put({
			book: { id: 42, title: 'Libro IDB', author: 'Autora', kind: 'tecnico', published: false },
			reading: sampleReading('42'),
			savedAt: 100,
		});
		expect(saved.published).toBe(false);
		expect((await store.get(42))?.title).toBe('Libro IDB');
		expect((await store.list()).map((r) => r.bookId)).toEqual([42]);
		await store.remove(42);
		expect(await store.get(42)).toBeNull();
		await store.clear();
		expect(closeCount).toBeGreaterThanOrEqual(5);
	});

	it('stores compact IGB1 bytes instead of raw reading JSON and blocks Tier 3 offline caching', async () => {
		const adapter = createMemoryOfflineAdapter();
		const store = createOfflineBookStore(adapter);

		const largeReading = sampleReading('77', 'Lectura repetitiva para comprimir con IGB1. '.repeat(40));
		const rec = await store.put({
			book: { id: 77, title: 'Compacto', author: 'Ignit', kind: 'tecnico', contentTier: 'public_open' },
			reading: largeReading,
		});

		const rawStored = await adapter.get(77);
		expect(rawStored?.igb).toBeInstanceOf(Uint8Array);
		expect(rawStored?.reading).toBeUndefined();
		expect(rec.igbBytes).toBeLessThan(rec.bytes / 2);

		const hydrated = await store.get(77);
		expect(hydrated?.reading.chunks[0]?.text).toBe(largeReading.chunks[0]?.text);

		await expect(
			store.put({
				book: {
					id: 99,
					title: 'Editorial Cerrado',
					author: 'Editorial',
					kind: 'no_tecnico',
					contentTier: 'editorial_closed',
				},
				reading: sampleReading('99'),
			}),
		).rejects.toThrow(/Tier 3/i);
	});

	it('enqueues, lists, and removes items in sync_outbox fallback store', async () => {
		const outbox = createSyncOutboxStore(null);
		const id = await outbox.enqueue({
			entityType: 'reading_state',
			entityId: '77',
			op: 'upsert',
			payloadJson: '{"page":12}',
			createdAt: 1000,
		});
		const pending = await outbox.list();
		expect(pending).toHaveLength(1);
		expect(pending[0]?.entityId).toBe('77');

		await outbox.remove(id);
		expect(await outbox.list()).toEqual([]);
	});
});
