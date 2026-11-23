import { describe, expect, it, vi } from 'vitest';
import { readerStorageKey, syncReadingStateToCloud } from '../../../widgets/reading/syncConfig';

describe('multi-user reader sync config', () => {
	it('scopes localStorage keys per userId and falls back to anon', () => {
		expect(readerStorageKey('user-a', 12)).toBe('ignit:book:user-a:12');
		expect(readerStorageKey('user-b', 12)).toBe('ignit:book:user-b:12');
		expect(readerStorageKey('', 12)).toBe('ignit:book:anon:12');
		expect(readerStorageKey(undefined, 12)).toBe('ignit:book:anon:12');
	});

	it('skips cloud persistence completely when canSync is false', async () => {
		const saveFn = vi.fn(async () => undefined);
		const result = await syncReadingStateToCloud(false, 7, { progress: { page: 2, pct: 10 } }, saveFn);
		expect(result).toBe('local-only');
		expect(saveFn).not.toHaveBeenCalled();
	});

	it('persists to cloud when canSync is true and reports errors cleanly', async () => {
		const saveOk = vi.fn(async () => undefined);
		await expect(
			syncReadingStateToCloud(true, 7, { progress: { page: 2, pct: 10 } }, saveOk),
		).resolves.toBe('synced');
		expect(saveOk).toHaveBeenCalledWith(7, { progress: { page: 2, pct: 10 } });

		const saveFail = vi.fn(async () => {
			throw new Error('Unauthorized');
		});
		await expect(
			syncReadingStateToCloud(true, 7, { progress: { page: 2, pct: 10 } }, saveFail),
		).resolves.toBe('error');
	});
});
