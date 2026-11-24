import type { BookKind } from '../../../entities/book/types';
import { kindLabel } from '../../landing/lib/catalog';

/**
 * Presentation helpers of the admin review queue (S5).
 *
 * The backend answers `AdminBookView` with raw serialized values — file size in
 * bytes as a string, `createdAt` as an ISO timestamp and the four AI columns —
 * so every rendering decision lives here as a pure function the Vitest suite
 * pins instead of inline JSX arithmetic.
 */
export type AdminAiSafety = 'ok' | 'suspect';

export type AdminAiStatus = 'ok' | 'suspect' | 'skipped';

/** One row of `GET /admin/books?review=pending`. */
export type AdminQueueBook = {
	id: number;
	title: string;
	author: string;
	kind: BookKind;
	ownerId: string;
	ownerEmail: string | null;
	fileSize: string | null;
	filePages: number | null;
	createdAt: string;
	published: boolean;
	reviewStatus: 'pending' | 'approved' | 'rejected';
	reviewNote: string | null;
	reviewedBy: string | null;
	reviewedAt: string | null;
	aiSafety: AdminAiSafety | null;
	aiQuality: number | null;
	aiNotes: string | null;
	aiStatus: AdminAiStatus | null;
};

/** Paginated envelope of the queue endpoint. */
export type AdminQueuePage = {
	items: AdminQueueBook[];
	total: number;
	offset: number;
	limit: number;
};

export type AdminAiVerdict = {
	tone: 'ok' | 'suspect' | 'skipped';
	label: string;
	qualityLabel: string | null;
	notes: string | null;
};

/** `834567` → `815 KB`; `2.0 MB` above 1 MiB; `sin archivo` when unknown. */
export function formatAdminFileSize(fileSize: string | null | undefined): string {
	if (!fileSize) return 'sin archivo';
	const bytes = Number(fileSize);
	if (!Number.isFinite(bytes) || bytes <= 0) return 'sin archivo';

	const mb = bytes / (1024 * 1024);
	if (mb >= 1) return `${mb.toFixed(1)} MB`;

	return `${Math.round(bytes / 1024)} KB`;
}

/** `2026-02-10T11:35:00Z` → `hace 25 min` (coarse age of the upload). */
export function formatAdminRelativeTime(
	createdAt: string | null | undefined,
	nowMs = Date.now(),
): string {
	if (!createdAt) return 'sin fecha';
	const createdMs = Date.parse(createdAt);
	if (!Number.isFinite(createdMs)) return 'sin fecha';

	const diffMin = Math.floor(Math.max(0, nowMs - createdMs) / 60_000);
	if (diffMin < 1) return 'recién';
	if (diffMin < 60) return `hace ${diffMin} min`;

	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return `hace ${diffHr} h`;

	return `hace ${Math.floor(diffHr / 24)} d`;
}

/** Kind label of the queue, reusing the catalog vocabulary. */
export function adminKindLabel(kind: BookKind | null | undefined): string {
	return kind === 'tecnico' || kind === 'no_tecnico' ? kindLabel(kind) : 'Sin categoría';
}

/**
 * Maps the four AI columns to the queue badge: `ok`, `suspect` (warning
 * styling) or `skipped` for a row the optional stage never analysed. Quality
 * only renders inside `1..5`; blank notes collapse to `null`.
 */
export function adminAiVerdict(
	row: Pick<AdminQueueBook, 'aiSafety' | 'aiQuality' | 'aiNotes' | 'aiStatus'>,
): AdminAiVerdict {
	const quality = row.aiQuality;
	const qualityLabel =
		typeof quality === 'number' && Number.isInteger(quality) && quality >= 1 && quality <= 5
			? `Calidad ${quality}/5`
			: null;
	const notes = row.aiNotes?.trim() ? row.aiNotes.trim() : null;

	if (row.aiSafety === 'suspect') {
		return { tone: 'suspect', label: 'IA: sospechoso', qualityLabel, notes };
	}

	if (row.aiSafety === 'ok') {
		return { tone: 'ok', label: 'IA: ok', qualityLabel, notes };
	}

	return { tone: 'skipped', label: 'IA: sin analizar', qualityLabel, notes };
}

/** 1-based page count of a `total`/`limit` window; never less than one page. */
export function adminQueuePageCount(total: number, limit: number): number {
	const size = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 20;
	const count = Number.isFinite(total) && total > 0 ? Math.trunc(total) : 0;
	return Math.max(1, Math.ceil(count / size));
}

export type AdminQueueWindow = {
	pageCount: number;
	page: number;
	hasPrev: boolean;
	hasNext: boolean;
	rangeLabel: string;
};

/** Page number and Prev/Next availability derived from `total` + `offset`. */
export function adminQueueWindow(
	page: Pick<AdminQueuePage, 'total' | 'offset' | 'limit'>,
): AdminQueueWindow {
	const limit = Number.isFinite(page.limit) && page.limit > 0 ? Math.trunc(page.limit) : 20;
	const total = Number.isFinite(page.total) && page.total > 0 ? Math.trunc(page.total) : 0;
	const offset = Number.isFinite(page.offset) && page.offset > 0 ? Math.trunc(page.offset) : 0;
	const pageCount = adminQueuePageCount(total, limit);
	const current = Math.min(pageCount, Math.floor(offset / limit) + 1);

	if (total === 0) {
		return { pageCount, page: 1, hasPrev: false, hasNext: false, rangeLabel: '0 PDFs' };
	}

	const from = offset + 1;
	const to = Math.min(offset + limit, total);
	return {
		pageCount,
		page: current,
		hasPrev: offset > 0,
		hasNext: offset + limit < total,
		rangeLabel: `${from}–${to} de ${total} PDFs`,
	};
}
