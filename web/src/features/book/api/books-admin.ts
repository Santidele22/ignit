import type { BookKind, ReadingStatus } from '../../../entities/book/types';
import { deleteJson, getBearerToken, getJson, patchJson, postJson, postJsonReturning } from '../../../shared/api/authorizedHttp';

export type AdminBookRow = {
	id: number;
	title: string;
	author: string;
	description: string;
	status: ReadingStatus;
	kind?: BookKind | null;
	review?: string | null;
	published?: boolean | null;
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
	ownerId?: string;
	isOwner?: boolean;
};

export type BookWriteBody = {
	title: string;
	author: string;
	description: string;
	status: ReadingStatus;
	kind: BookKind;
	review: string | null;
	published: boolean;
	coverUrl?: string | null;
	publisher?: string | null;
	translator?: string | null;
	illustrator?: string | null;
	isbn?: string | null;
	license?: string | null;
	ctaLabel?: string | null;
	ctaUrl?: string | null;
};

export type LicenseComplianceStatus = 'open' | 'copyrighted' | 'unknown';

export type SuggestedBookMetadata = {
	title: string | null;
	author: string | null;
	description: string | null;
	coverQueries?: string[];
	license?: string | null;
	licenseStatus?: LicenseComplianceStatus;
	licenseReason?: string | null;
};

export type CoverSearchCandidate = {
	title: string;
	authors: string[];
	coverUrl: string;
};

export function suggestBookMetadata(
	input: string | { filename?: string; title?: string; author?: string },
): Promise<SuggestedBookMetadata> {
	const payload = typeof input === 'string' ? { filename: input } : input;
	return postJsonReturning<SuggestedBookMetadata>('/books/suggest-metadata', payload);
}

export function searchBookCovers(
	title: string,
	author = '',
	altQueries: string[] = [],
): Promise<CoverSearchCandidate[]> {
	const params = new URLSearchParams({ title });
	if (author.trim()) params.set('author', author.trim());
	for (const alt of altQueries) {
		const cleaned = alt.trim();
		if (cleaned) params.append('alt', cleaned);
	}
	return getJson<CoverSearchCandidate[]>(`/books/cover-search?${params.toString()}`);
}

const baseUrl = (import.meta.env.PUBLIC_API_BASE_URL || '/api').replace(/\/+$/, '');

const CONNECTION_ERROR = 'No se pudo conectar con el servidor. Inténtalo de nuevo en unos minutos.';
const GENERIC_ERROR = 'El servidor no pudo completar la solicitud.';

type ErrorPayload = {
	message?: string | string[];
};

/** Loads only books owned by the signed-in user (private + published). */
export function fetchMyBooks(): Promise<AdminBookRow[]> {
	return getJson<AdminBookRow[]>('/books?mine=true');
}

export function createBook(body: BookWriteBody): Promise<void> {
	return postJson('/books', body);
}

export function createBookReturning(body: BookWriteBody): Promise<AdminBookRow> {
	return postJsonReturning<AdminBookRow>('/books', body);
}

export function updateBook(id: number, body: BookWriteBody): Promise<void> {
	return patchJson(`/books/${id}`, body);
}

export function deleteBook(id: number): Promise<void> {
	return deleteJson(`/books/${id}`);
}

export async function uploadBookFile(
	id: number,
	file: File,
	options: { publish?: boolean } = {},
): Promise<AdminBookRow> {
	const body = new FormData();
	body.append('file', file);
	const query = options.publish ? '?publish=true' : '';

	let response: Response;

	try {
		const token = await getBearerToken();
		response = await fetch(`${baseUrl}/books/${id}/file${query}`, {
			method: 'POST',
			credentials: 'include',
			headers: token ? { Authorization: `Bearer ${token}` } : undefined,
			body,
		});
	} catch {
		throw new Error(CONNECTION_ERROR);
	}

	if (!response.ok) {
		const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
		const message = Array.isArray(payload?.message) ? payload.message[0] : payload?.message;
		throw new Error(message || GENERIC_ERROR);
	}

	return (await response.json()) as AdminBookRow;
}
