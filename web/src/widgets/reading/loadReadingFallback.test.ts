import { describe, expect, it, vi } from 'vitest';
import type { BookReadingDocument } from '../../entities/book/types';
import { resolveReadingDocument } from './loadReadingFallback';

const remoteDoc: BookReadingDocument = {
	bookId: '5',
	pdfPages: 120,
	ocrPending: false,
	chunks: [],
};

const cachedDoc: BookReadingDocument = {
	bookId: '5',
	pdfPages: 120,
	ocrPending: false,
	chunks: [
		{ id: 'c1', type: 'para', page: 1, offset: 0, text: 'Offline copy', mood: 'espera', cues: [] },
	],
};

describe('resolveReadingDocument (reader IndexedDB fallback)', () => {
	it('uses network when online and remote fetch succeeds', async () => {
		const fetchRemote = vi.fn().mockResolvedValue(remoteDoc);
		const getCached = vi.fn().mockResolvedValue({ reading: cachedDoc });

		const result = await resolveReadingDocument(5, true, {
			isOnline: () => true,
			fetchRemote,
			getCached,
		});

		expect(result).toEqual({ reading: remoteDoc, source: 'network' });
		expect(fetchRemote).toHaveBeenCalledWith(5, true);
		expect(getCached).not.toHaveBeenCalled();
	});

	it('falls back to IndexedDB when online remote fetch fails', async () => {
		const fetchRemote = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
		const getCached = vi.fn().mockResolvedValue({ reading: cachedDoc });

		const result = await resolveReadingDocument(5, true, {
			isOnline: () => true,
			fetchRemote,
			getCached,
		});

		expect(result).toEqual({ reading: cachedDoc, source: 'offline' });
		expect(getCached).toHaveBeenCalledWith(5);
	});

	it('reads IndexedDB first when offline and skips network when cached', async () => {
		const fetchRemote = vi.fn();
		const getCached = vi.fn().mockResolvedValue({ reading: cachedDoc });

		const result = await resolveReadingDocument(5, true, {
			isOnline: () => false,
			fetchRemote,
			getCached,
		});

		expect(result).toEqual({ reading: cachedDoc, source: 'offline' });
		expect(fetchRemote).not.toHaveBeenCalled();
	});

	it('throws a clear offline error when offline and book is not cached', async () => {
		const fetchRemote = vi.fn();
		const getCached = vi.fn().mockResolvedValue(null);

		await expect(
			resolveReadingDocument(5, false, {
				isOnline: () => false,
				fetchRemote,
				getCached,
			}),
		).rejects.toThrow(/Sin conexión/i);
		expect(fetchRemote).not.toHaveBeenCalled();
	});

	it('rethrows the remote error when online and no offline cache exists', async () => {
		const fetchRemote = vi.fn().mockRejectedValue(new Error('500 Server Error'));
		const getCached = vi.fn().mockResolvedValue(null);

		await expect(
			resolveReadingDocument(5, true, {
				isOnline: () => true,
				fetchRemote,
				getCached,
			}),
		).rejects.toThrow('500 Server Error');
	});

	it('preserves original remote error when online fetch fails and IndexedDB rejects', async () => {
		const fetchRemote = vi.fn().mockRejectedValue(new Error('HTTP 503 Service Unavailable'));
		const getCached = vi.fn().mockRejectedValue(new Error('IDB blocked'));

		await expect(
			resolveReadingDocument(9, true, { isOnline: () => true, fetchRemote, getCached }),
		).rejects.toThrow('HTTP 503 Service Unavailable');
	});

	it('throws clean Spanish offline message when offline and IndexedDB rejects', async () => {
		const fetchRemote = vi.fn();
		const getCached = vi.fn().mockRejectedValue(new Error('IDB corrupted'));

		await expect(
			resolveReadingDocument(9, false, { isOnline: () => false, fetchRemote, getCached }),
		).rejects.toThrow('Sin conexión y este libro no está descargado en tu dispositivo.');
		expect(fetchRemote).not.toHaveBeenCalled();
	});
});
