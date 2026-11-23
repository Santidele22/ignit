import type { BookReadingState } from '../../entities/book/types';

export type CloudSyncResult = 'synced' | 'local-only' | 'error';

export function readerStorageKey(userId: string | undefined, bookId: number): string {
	const cleanUser = userId && userId.trim().length > 0 ? userId.trim() : 'anon';
	return `ignit:book:${cleanUser}:${bookId}`;
}

export async function syncReadingStateToCloud(
	canSync: boolean,
	bookId: number,
	payload: Partial<BookReadingState>,
	saveFn: (id: number, state: Partial<BookReadingState>) => Promise<void>,
): Promise<CloudSyncResult> {
	if (!canSync) {
		return 'local-only';
	}

	try {
		await saveFn(bookId, payload);
		return 'synced';
	} catch {
		return 'error';
	}
}
