import { describe, expect, it } from 'vitest';
import type { BookReadingDocument } from '../../../entities/book/types';
import {
	bytesToKb,
	createMemoryOfflineAdapter,
	createOfflineBookStore,
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
});
