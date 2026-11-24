import { getJson, postJsonReturning } from '../../../shared/api/authorizedHttp';
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
};

/** Rows per page of the queue; the backend clamps to the shared window. */
export const ADMIN_QUEUE_PAGE_SIZE = 20;

/** `GET /admin/books` — one page of the pending review queue. */
export function fetchAdminQueue(query: AdminQueueQuery = {}): Promise<AdminQueuePage> {
	const page = Math.max(1, Math.trunc(query.page ?? 1));
	const pageSize = Math.max(1, Math.trunc(query.pageSize ?? ADMIN_QUEUE_PAGE_SIZE));
	const review = query.review ?? 'pending';

	return getJson<AdminQueuePage>(
		`/admin/books?review=${encodeURIComponent(review)}&page=${page}&pageSize=${pageSize}`,
	);
}

/** `POST /admin/books/:id/review` — records the decision, answers the new row. */
export function submitAdminReview(id: number, body: ReviewRequestBody): Promise<AdminQueueBook> {
	return postJsonReturning<AdminQueueBook>(`/admin/books/${id}/review`, body);
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
