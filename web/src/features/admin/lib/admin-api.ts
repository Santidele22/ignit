import { getJson, patchJson, postJsonReturning } from '../../../shared/api/authorizedHttp';
import type { FirewallReport } from './admin-firewall';
import type { AdminQueueBook, AdminQueuePage } from './admin-queue';

/**
 * Client of the admin review surface (S4 endpoints, S5 dashboard).
 *
 * Reuses the authorized fetch helpers (`authorizedHttp.ts` → `http.ts`), so the
 * session cookie and — in managed mode — the bearer token travel exactly like
 * every other authenticated call of the app.
 */
export type ReviewDecision = 'approved' | 'rejected';

export type ReviewRequestBody = {
	decision: ReviewDecision;
	note?: string;
	/** Only an explicit flag publishes the book as part of an approval. */
	publish?: boolean;
};

export type AdminQueueQuery = {
	page?: number;
	pageSize?: number;
	review?: 'pending' | 'approved' | 'rejected';
	published?: boolean;
};

/** Rows per page of the queue; the backend clamps to the shared window. */
export const ADMIN_QUEUE_PAGE_SIZE = 20;

/** `GET /admin/books` — one page of the review queue or published catalog. */
export function fetchAdminQueue(query: AdminQueueQuery = {}): Promise<AdminQueuePage> {
	const page = Math.max(1, Math.trunc(query.page ?? 1));
	const pageSize = Math.max(1, Math.trunc(query.pageSize ?? ADMIN_QUEUE_PAGE_SIZE));
	const params = new URLSearchParams();
	if (query.published !== undefined) {
		params.set('published', String(query.published));
		if (query.review) params.set('review', query.review);
	} else {
		params.set('review', query.review ?? 'pending');
	}
	params.set('page', String(page));
	params.set('pageSize', String(pageSize));

	return getJson<AdminQueuePage>(`/admin/books?${params.toString()}`);
}

/** `POST /admin/books/:id/review` — records the decision, answers the new row. */
export function submitAdminReview(id: number, body: ReviewRequestBody): Promise<AdminQueueBook> {
	return postJsonReturning<AdminQueueBook>(`/admin/books/${id}/review`, body);
}

/** `POST /admin/books/:id/unpublish` — immediately removes a book from the public catalog. */
export function unpublishAdminBook(id: number, note?: string): Promise<AdminQueueBook> {
	const trimmed = note?.trim();
	return postJsonReturning<AdminQueueBook>(
		`/admin/books/${id}/unpublish`,
		trimmed ? { note: trimmed } : {},
	);
}

/** `GET /admin/books/:id/firewall` — stored pipeline report of one upload. */
export function fetchFirewallReport(id: number): Promise<FirewallReport> {
	return getJson<FirewallReport>(`/admin/books/${id}/firewall`);
}

/** Editorial style reference type served by `GET /admin/ai/style-reference`. */
export type StyleReference = {
	role: string;
	securityBoundary: string;
	qualityLabel: string;
	qualityRubric: Array<{ score: number; description: string }>;
	safetyRule: string;
	outputShape: string;
	inputs: { readingText: string; maxCharacters: number };
	neverJudges: string[];
};

/** `GET /admin/ai/style-reference` — what the LLM actually judges with. */
export function fetchStyleReference(): Promise<StyleReference> {
	return getJson<StyleReference>('/admin/ai/style-reference');
}

export type ClutterItem = {
	id: string;
	page: number;
	text: string;
	reason: string;
	action: 'dropped' | 'recommended';
};

export type BookClutterResponse = {
	bookId: number;
	refinedByAi: boolean;
	clutter: ClutterItem[];
};

export type RefineSummaryResponse = {
	bookId: number;
	applied: boolean;
	model?: string;
	reclassified: number;
	merged: number;
	dropped: number;
	clutter?: ClutterItem[];
};

/** `GET /admin/books/:id/clutter` — AI-detected clutter list for one book. */
export function fetchBookClutter(id: number): Promise<BookClutterResponse> {
	return getJson<BookClutterResponse>(`/admin/books/${id}/clutter`);
}

/** `POST /admin/books/:id/clutter/drop` — drops recommended clutter chunks. */
export function dropBookClutter(
	id: number,
	chunkIds: string[],
): Promise<{ bookId: number; dropped: number; clutter: ClutterItem[] }> {
	return postJsonReturning(`/admin/books/${id}/clutter/drop`, { chunkIds });
}

/** `POST /admin/books/:id/refine` — re-runs LLM structural refiner. */
export function rerunBookRefinement(id: number): Promise<RefineSummaryResponse> {
	return postJsonReturning(`/admin/books/${id}/refine`, {});
}

/** `POST /admin/books/:id/refine/revert` — restores deterministic baseline. */
export function revertBookRefinement(id: number): Promise<{ bookId: number; reverted: boolean }> {
	return postJsonReturning(`/admin/books/${id}/refine/revert`, {});
}

/** `POST /admin/books/:id/reextract` — re-extracts from stored PDF + re-runs LLM refiner. */
export function reextractBookReading(
	id: number,
): Promise<RefineSummaryResponse & { totalChunks: number }> {
	return postJsonReturning(`/admin/books/${id}/reextract`, {});
}

export type AdminChunkType =
	| 'para'
	| 'heading'
	| 'verse'
	| 'toc'
	| 'quote'
	| 'list'
	| 'dedication'
	| 'meta'
	| 'caption'
	| 'code';

export type AdminReadingChunk = {
	id: string;
	page: number;
	type: AdminChunkType;
	level?: 1 | 2 | 3;
	align?: 'left' | 'center' | 'right';
	text: string;
};

export type AdminReadingChunksResponse = {
	bookId: number;
	refinedByAi: boolean;
	totalChunks: number;
	filteredTotal: number;
	chunks: AdminReadingChunk[];
};

export type AdminChunkPatch =
	| { op: 'reclassify'; id: string; type: AdminChunkType; level?: 1 | 2 | 3 }
	| { op: 'drop'; id: string; reason?: string }
	| { op: 'merge'; id: string };

/** `GET /admin/books/:id/chunks` — lists reading.json chunks for manual editing. */
export function fetchBookChunks(
	id: number,
	query: { page?: number; q?: string; offset?: number; limit?: number } = {},
): Promise<AdminReadingChunksResponse> {
	const params = new URLSearchParams();
	if (typeof query.page === 'number' && Number.isFinite(query.page)) {
		params.set('page', String(query.page));
	}
	if (query.q && query.q.trim()) params.set('q', query.q.trim());
	if (typeof query.offset === 'number') params.set('offset', String(query.offset));
	if (typeof query.limit === 'number') params.set('limit', String(query.limit));
	const qs = params.toString();
	return getJson<AdminReadingChunksResponse>(
		`/admin/books/${id}/chunks${qs ? `?${qs}` : ''}`,
	);
}

/** `PATCH /admin/books/:id/chunks` — applies manual structural patches to reading.json. */
export function patchBookChunks(id: number, patches: AdminChunkPatch[]): Promise<void> {
	return patchJson(`/admin/books/${id}/chunks`, { patches });
}
