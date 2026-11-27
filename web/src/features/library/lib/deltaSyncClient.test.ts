import { describe, expect, it, vi } from 'vitest';
import { createSyncOutboxStore } from './offlineStore';
import { runDeltaSync, type DeltaSyncTransport } from './deltaSyncClient';

describe('deltaSyncClient (Web & Desktop convergence)', () => {
	it('flushes outbox on push, uploads Tier 2 IGB1 when uploadUrl is returned, and applies pull deltas', async () => {
		const outbox = createSyncOutboxStore(null);
		await outbox.enqueue({
			entityType: 'reading_state',
			entityId: '10',
			op: 'upsert',
			payloadJson: JSON.stringify({ page: 55, pct: 0.55 }),
			createdAt: 1000,
		});

		const uploaded: string[] = [];
		const pulledBooks: number[] = [];
		const pulledStates: number[] = [];
		let savedSyncAt = 0;

		const transport: DeltaSyncTransport = {
			push: vi.fn(async (items) => ({
				serverTime: 2000,
				acked: items.map((it) => ({
					clientOpId: String(it.clientOpId),
					status: 'applied' as const,
					remoteId: 10,
					uploadUrl: 'https://r2.example.com/put/10.igb',
				})),
			})),
			pull: vi.fn(async () => ({
				serverTime: 2005,
				books: [
					{
						id: 10,
						title: 'Ficciones',
						author: 'Borges',
						kind: 'ficcion',
						status: 'reading',
						contentTier: 'private_user',
						contentHash: 'abc',
						igbPath: 'books/private/u1/10.igb',
						igbSize: 1200,
						igbDownloadUrl: 'https://r2.example.com/get/10.igb',
						updatedAt: 2000,
						deletedAt: null,
					},
				],
				readingStates: [
					{
						bookId: 10,
						status: 'reading',
						progressJson: '{"page":55,"pct":0.55}',
						marksJson: null,
						wordsJson: null,
						updatedAt: 2000,
					},
				],
			})),
		};

		const result = await runDeltaSync({
			outbox,
			transport,
			since: 0,
			onUploadIgb: async (ack) => {
				if (ack.uploadUrl) uploaded.push(ack.uploadUrl);
			},
			onPulledBook: async (b) => {
				pulledBooks.push(b.id);
			},
			onPulledState: async (s) => {
				pulledStates.push(s.bookId);
			},
			onSetLastSyncAt: async (ts) => {
				savedSyncAt = ts;
			},
		});

		expect(result).toEqual({
			pushed: 1,
			pulledBooks: 1,
			pulledStates: 1,
			serverTime: 2005,
		});
		expect(uploaded).toEqual(['https://r2.example.com/put/10.igb']);
		expect(pulledBooks).toEqual([10]);
		expect(pulledStates).toEqual([10]);
		expect(savedSyncAt).toBe(2005);
		expect(await outbox.list()).toEqual([]);
	});

	it('preserves outbox items when offline / push fails so retry succeeds later', async () => {
		const outbox = createSyncOutboxStore(null);
		await outbox.enqueue({
			entityType: 'reading_state',
			entityId: '10',
			op: 'upsert',
			payloadJson: '{"page":12}',
			createdAt: 1000,
		});

		const failingTransport: DeltaSyncTransport = {
			push: vi.fn(async () => {
				throw new Error('Network offline');
			}),
			pull: vi.fn(),
		};

		await expect(
			runDeltaSync({ outbox, transport: failingTransport, since: 0 }),
		).rejects.toThrow('Network offline');

		expect(await outbox.list()).toHaveLength(1);
	});
});
