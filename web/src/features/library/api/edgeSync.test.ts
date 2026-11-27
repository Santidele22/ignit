import { describe, expect, it, vi } from 'vitest';
import { handleEdgeSyncPull, handleEdgeSyncPush } from './edgeSync';

describe('Edge Sync (Cloudflare Worker + Neon HTTP SQL)', () => {
	it('applies newer reading_state and ignores stale updates with LWW', async () => {
		const calls: Array<{ query: string; params: unknown[] }> = [];
		const sql = vi.fn(async (query: string, params: unknown[] = []) => {
			calls.push({ query, params });
			if (query.includes('FROM reading_states')) {
				return [{ updatedAtMs: 5000 }] as never;
			}
			return [] as never;
		});

		const res = await handleEdgeSyncPush(
			'user-1',
			[
				{
					clientOpId: 'stale-op',
					entityType: 'reading_state',
					op: 'upsert',
					bookId: 10,
					updatedAt: 3000,
					payload: { page: 5 },
				},
				{
					clientOpId: 'newer-op',
					entityType: 'reading_state',
					op: 'upsert',
					bookId: 10,
					updatedAt: 9000,
					payload: { page: 42, pct: 0.42 },
				},
			],
			sql,
		);

		expect(res.acked).toEqual([
			{ clientOpId: 'stale-op', status: 'ignored_stale', remoteId: 10 },
			{ clientOpId: 'newer-op', status: 'applied', remoteId: 10 },
		]);
		expect(calls.some((c) => c.query.includes('INSERT INTO reading_states'))).toBe(true);
	});

	it('pulls changed books and reading_states since lastSyncAt', async () => {
		const sql = vi.fn(async (query: string) => {
			if (query.includes('FROM books')) {
				return [
					{
						id: 10,
						title: 'Ficciones',
						author: 'Borges',
						kind: 'ficcion',
						status: 'reading',
						contentTier: 'private_user',
						contentHash: 'abc',
						igbPath: 'books/private/user-1/10.igb',
						igbSize: 1500,
						updatedAtMs: 8000,
						deletedAtMs: null,
					},
				] as never;
			}
			return [
				{
					bookId: 10,
					status: 'reading',
					progressJson: '{"page":42,"pct":0.42}',
					marksJson: null,
					wordsJson: null,
					updatedAtMs: 8000,
				},
			] as never;
		});

		const pulled = await handleEdgeSyncPull('user-1', 1000, sql);
		expect(pulled.books).toHaveLength(1);
		expect(pulled.books[0]?.igbPath).toBe('books/private/user-1/10.igb');
		expect(pulled.readingStates).toHaveLength(1);
		expect(pulled.readingStates[0]?.bookId).toBe(10);
	});
});
