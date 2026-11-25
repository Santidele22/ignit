import type {
	Book,
	BookKind,
	BookMetricEvent,
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
	reviewStatus?: 'pending' | 'approved' | 'rejected' | null;
	coverUrl?: string | null;
	publisher?: string | null;
	translator?: string | null;
	illustrator?: string | null;
	isbn?: string | null;
	license?: string | null;
	ctaLabel?: string | null;
	ctaUrl?: string | null;
	originalName?: string | null;
	fileSize?: string | null;
	mimeType?: string | null;
	filePath?: string | null;
	isOwner?: boolean;
};

export function safeExternalUrl(raw: string | null | undefined): string | undefined {
	if (!raw) return undefined;
	const trimmed = raw.trim();
	if (!/^https?:\/\//i.test(trimmed)) return undefined;
	try {
		const parsed = new URL(trimmed);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined;
	} catch {
		return undefined;
	}
}

function parseOptionalFileSize(raw: string | null | undefined): number | undefined {
	if (!raw) return undefined;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function mapBook(book: ApiBook): Book {
	const status = READING_STATUSES.includes(book.status as ReadingStatus)
		? (book.status as ReadingStatus)
		: 'queued';
	const kind = BOOK_KINDS.includes(book.kind as BookKind)
		? (book.kind as BookKind)
		: 'no_tecnico';
	const fileSizeBytes = parseOptionalFileSize(book.fileSize);

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
		...(book.reviewStatus ? { reviewStatus: book.reviewStatus } : {}),
		...(book.coverUrl ? { coverUrl: book.coverUrl } : {}),
		...(book.publisher ? { publisher: book.publisher } : {}),
		...(book.translator ? { translator: book.translator } : {}),
		...(book.illustrator ? { illustrator: book.illustrator } : {}),
		...(book.isbn ? { isbn: book.isbn } : {}),
		...(book.license ? { license: book.license } : {}),
		...(book.ctaLabel ? { ctaLabel: book.ctaLabel } : {}),
		...(safeExternalUrl(book.ctaUrl) ? { ctaUrl: safeExternalUrl(book.ctaUrl) } : {}),
		hasFile: Boolean(book.filePath || book.originalName),
		...(fileSizeBytes !== undefined ? { fileSizeBytes } : {}),
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

export async function fetchMyBooksServer(
	optionsOrOrigin?: string | RequestOptions,
): Promise<Book[] | null> {
	try {
		const rows = await getJson<ApiBook[]>('/books?mine=true', toRequestOptions(optionsOrOrigin));
		return rows.map((row) => ({ ...mapBook(row), isOwner: true }));
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

/**
 * Fire-and-forget per-book metric ping (`read_started`, `offline_download`,
 * `cta_click`). Uses `keepalive: true` so outbound CTA clicks still deliver
 * even when the browser navigates away.
 */
export function recordBookMetric(id: number, event: BookMetricEvent): void {
	if (!Number.isInteger(id) || id <= 0 || typeof fetch !== 'function') return;
	const base = (import.meta.env.PUBLIC_API_BASE_URL || '/api').replace(/\/+$/, '');
	void fetch(`${base}/books/${id}/metrics`, {
		method: 'POST',
		credentials: 'include',
		keepalive: true,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ event }),
	}).catch(() => undefined);
}
