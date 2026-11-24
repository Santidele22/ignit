import type { BookReadingDocument } from '../../entities/book/types';
import { fetchBookClientReading } from '../../features/book/api/books';
import { getOfflineBook } from '../../features/library/lib/offlineStore';

export type ReadingDocumentSource = 'network' | 'offline';

export interface ResolvedReadingDocument {
	reading: BookReadingDocument;
	source: ReadingDocumentSource;
}

export interface ReadingFallbackDeps {
	isOnline: () => boolean;
	fetchRemote: (bookId: number, canSync: boolean) => Promise<BookReadingDocument>;
	getCached: (bookId: number) => Promise<{ reading: BookReadingDocument } | null>;
}

const defaultDeps: ReadingFallbackDeps = {
	isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
	fetchRemote: fetchBookClientReading,
	getCached: getOfflineBook,
};

export async function resolveReadingDocument(
	bookId: number,
	canSync: boolean,
	deps: ReadingFallbackDeps = defaultDeps,
): Promise<ResolvedReadingDocument> {
	if (!deps.isOnline()) {
		const cached = await deps.getCached(bookId).catch(() => null);
		if (cached?.reading) {
			return { reading: cached.reading, source: 'offline' };
		}
		throw new Error('Sin conexión y este libro no está descargado en tu dispositivo.');
	}

	try {
		const reading = await deps.fetchRemote(bookId, canSync);
		return { reading, source: 'network' };
	} catch (remoteError) {
		const cached = await deps.getCached(bookId).catch(() => null);
		if (cached?.reading) {
			return { reading: cached.reading, source: 'offline' };
		}
		throw remoteError;
	}
}
