import type {
	Book,
	BookKind,
	BookReadingDocument,
	BookReadingState,
	ReadingStatus,
} from '../../../entities/book/types';
import { getJson, type RequestOptions } from '../../../shared/api/http';
import {
	getJson as authorizedGetJson,
	putJson as authorizedPutJson,
} from '../../../shared/api/authorizedHttp';
import type { Paged } from '../../../shared/api/pagination';

const READING_STATUSES: ReadingStatus[] = ['reading', 'finished', 'queued'];
const BOOK_KINDS: BookKind[] = ['tecnico', 'no_tecnico'];

const STATUS_LABELS: Record<ReadingStatus, string> = {
	reading: 'Leyendo',
	finished: 'Terminado',
	queued: 'En cola',
};

type ApiBook = {
	id: number;
	title: string;
	author: string;
	description: string;
	status?: string | null;
	kind?: string | null;
	review?: string | null;
	published?: boolean | null;
	originalName?: string | null;
	fileSize?: string | null;
	mimeType?: string | null;
	filePath?: string | null;
	isOwner?: boolean;
};

function mapBook(book: ApiBook): Book {
	const status = READING_STATUSES.includes(book.status as ReadingStatus)
		? (book.status as ReadingStatus)
		: 'queued';
	const kind = BOOK_KINDS.includes(book.kind as BookKind)
		? (book.kind as BookKind)
		: 'no_tecnico';

	return {
		id: book.id,
		title: book.title,
		author: book.author,
		description: book.description,
		status,
		statusLabel: STATUS_LABELS[status],
		kind,
		review: book.review ?? undefined,
		published: book.published === true,
		hasFile: Boolean(book.filePath || book.originalName),
		...(typeof book.isOwner === 'boolean' ? { isOwner: book.isOwner } : {}),
	};
}

function toRequestOptions(optionsOrOrigin?: string | RequestOptions): RequestOptions {
	if (typeof optionsOrOrigin === 'string') {
		return { serverOrigin: optionsOrOrigin };
	}

	return optionsOrOrigin ?? {};
}

export async function fetchBooks(serverOrigin?: string): Promise<Book[] | null> {
	try {
		const rows = await getJson<ApiBook[]>('/books', { serverOrigin });
		return rows.filter((book) => book.published === true).map(mapBook);
	} catch {
		return null;
	}
}

export async function fetchBooksPage(
	serverOrigin: string | undefined,
	offset: number | undefined,
	limit: number,
	published?: boolean,
	kind?: string,
): Promise<Paged<Book> | null> {
	try {
		const params = new URLSearchParams();
		if (offset !== undefined) params.set('offset', String(offset));
		if (limit !== undefined) params.set('limit', String(limit));
		if (published !== undefined) params.set('published', String(published));
		if (kind) params.set('kind', kind);
		const query = params.toString();
		const page = await getJson<Paged<ApiBook>>(`/books${query ? `?${query}` : ''}`, { serverOrigin });
		return { ...page, items: page.items.map(mapBook) };
	} catch {
		return null;
	}
}

export async function fetchBookById(
	id: number,
	optionsOrOrigin?: string | RequestOptions,
): Promise<Book | null> {
	try {
		const row = await getJson<ApiBook>(`/books/${id}`, toRequestOptions(optionsOrOrigin));
		return mapBook(row);
	} catch {
		return null;
	}
}

export async function fetchBookReading(
	id: number,
	optionsOrOrigin?: string | RequestOptions,
): Promise<BookReadingDocument | null> {
	try {
		return await getJson<BookReadingDocument>(`/books/${id}/reading`, toRequestOptions(optionsOrOrigin));
	} catch {
		return null;
	}
}

export async function fetchBookClientReading(
	id: number,
	canSync = true,
): Promise<BookReadingDocument> {
	if (canSync) {
		return authorizedGetJson<BookReadingDocument>(`/books/${id}/reading`);
	}
	return getJson<BookReadingDocument>(`/books/${id}/reading`);
}

export async function fetchBookReadingState(
	id: number,
	optionsOrOrigin?: string | RequestOptions,
): Promise<BookReadingState | null> {
	try {
		return await getJson<BookReadingState>(
			`/books/${id}/reading-state`,
			toRequestOptions(optionsOrOrigin),
		);
	} catch {
		return null;
	}
}

export async function saveBookReadingState(
	id: number,
	state: Partial<BookReadingState>,
): Promise<void> {
	await authorizedPutJson(`/books/${id}/reading-state`, state);
}
