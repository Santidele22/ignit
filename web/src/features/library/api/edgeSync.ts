import type { SqlRunner } from '../../../shared/api/neonHttpSql';
import type {
	DeltaSyncPullResponse,
	DeltaSyncPushAck,
} from '../lib/deltaSyncClient';

export interface EdgeSyncPushItem {
	clientOpId: string;
	entityType: 'book' | 'reading_state';
	op: 'upsert' | 'delete';
	bookId?: number;
	updatedAt: number;
	payload?: Record<string, unknown>;
}

export async function handleEdgeSyncPush(
	userId: string,
	items: EdgeSyncPushItem[],
	sql: SqlRunner,
): Promise<{ serverTime: number; acked: DeltaSyncPushAck[] }> {
	const acked: DeltaSyncPushAck[] = [];

	for (const item of items) {
		if (item.entityType === 'reading_state' && item.bookId) {
			const existing = await sql<{ updatedAtMs: number }>(
				`SELECT (EXTRACT(EPOCH FROM "updatedAt") * 1000)::bigint AS "updatedAtMs"
				 FROM reading_states WHERE "userId" = $1 AND "bookId" = $2 LIMIT 1`,
				[userId, item.bookId],
			);
			const currentMs = Number(existing[0]?.updatedAtMs ?? 0);
			if (existing.length > 0 && currentMs > item.updatedAt) {
				acked.push({
					clientOpId: item.clientOpId,
					status: 'ignored_stale',
					remoteId: item.bookId,
				});
				continue;
			}

			const payload = item.payload ?? {};
			const progressJson =
				payload.page !== undefined || payload.pct !== undefined || payload.chunkId !== undefined
					? JSON.stringify({
							page: Number(payload.page ?? 1),
							pct: Number(payload.pct ?? 0),
							...(payload.chunkId ? { chunkId: String(payload.chunkId) } : {}),
						})
					: null;
			const status = typeof payload.status === 'string' ? payload.status : 'reading';
			const marksJson = typeof payload.marksJson === 'string' ? payload.marksJson : null;
			const wordsJson = typeof payload.wordsJson === 'string' ? payload.wordsJson : null;
			const updatedIso = new Date(item.updatedAt).toISOString();

			await sql(
				`INSERT INTO reading_states ("userId", "bookId", status, "progressJson", "marksJson", "wordsJson", "updatedAt")
				 VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
				 ON CONFLICT ("userId", "bookId") DO UPDATE SET
					status = COALESCE(EXCLUDED.status, reading_states.status),
					"progressJson" = COALESCE(EXCLUDED."progressJson", reading_states."progressJson"),
					"marksJson" = COALESCE(EXCLUDED."marksJson", reading_states."marksJson"),
					"wordsJson" = COALESCE(EXCLUDED."wordsJson", reading_states."wordsJson"),
					"updatedAt" = EXCLUDED."updatedAt"`,
				[userId, item.bookId, status, progressJson, marksJson, wordsJson, updatedIso],
			);

			acked.push({
				clientOpId: item.clientOpId,
				status: 'applied',
				remoteId: item.bookId,
			});
			continue;
		}

		if (item.entityType === 'book' && item.op === 'delete' && item.bookId) {
			const rows = await sql<{ id: number; updatedAtMs: number }>(
				`SELECT id, (EXTRACT(EPOCH FROM "updatedAt") * 1000)::bigint AS "updatedAtMs"
				 FROM books WHERE id = $1 AND "ownerId" = $2 LIMIT 1`,
				[item.bookId, userId],
			);
			if (rows.length === 0) {
				acked.push({ clientOpId: item.clientOpId, status: 'rejected' });
				continue;
			}
			if (item.updatedAt < Number(rows[0].updatedAtMs ?? 0)) {
				acked.push({
					clientOpId: item.clientOpId,
					status: 'ignored_stale',
					remoteId: item.bookId,
				});
				continue;
			}
			const delIso = new Date(item.updatedAt).toISOString();
			await sql(
				`UPDATE books SET "deletedAt" = $1::timestamptz, "updatedAt" = $1::timestamptz
				 WHERE id = $2 AND "ownerId" = $3`,
				[delIso, item.bookId, userId],
			);
			acked.push({ clientOpId: item.clientOpId, status: 'applied', remoteId: item.bookId });
			continue;
		}

		acked.push({ clientOpId: item.clientOpId, status: 'rejected' });
	}

	return { serverTime: Date.now(), acked };
}

export async function handleEdgeSyncPull(
	userId: string,
	sinceEpochMs: number,
	sql: SqlRunner,
): Promise<DeltaSyncPullResponse> {
	const serverTime = Date.now();
	const books = await sql<{
		id: number;
		title: string;
		author: string;
		kind: string;
		status: string;
		contentTier: string | null;
		contentHash: string | null;
		igbPath: string | null;
		igbSize: number | null;
		updatedAtMs: number;
		deletedAtMs: number | null;
	}>(
		`SELECT id, title, author, kind, status, "contentTier", "contentHash", "igbPath", "igbSize",
				(EXTRACT(EPOCH FROM "updatedAt") * 1000)::bigint AS "updatedAtMs",
				CASE WHEN "deletedAt" IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM "deletedAt") * 1000)::bigint END AS "deletedAtMs"
		 FROM books
		 WHERE "ownerId" = $1
		   AND GREATEST(
			   COALESCE((EXTRACT(EPOCH FROM "updatedAt") * 1000)::bigint, 0),
			   COALESCE((EXTRACT(EPOCH FROM "deletedAt") * 1000)::bigint, 0)
		   ) > $2`,
		[userId, sinceEpochMs],
	);

	const readingStates = await sql<{
		bookId: number;
		status: string;
		progressJson: string | null;
		marksJson: string | null;
		wordsJson: string | null;
		updatedAtMs: number;
	}>(
		`SELECT "bookId", status, "progressJson", "marksJson", "wordsJson",
				(EXTRACT(EPOCH FROM "updatedAt") * 1000)::bigint AS "updatedAtMs"
		 FROM reading_states
		 WHERE "userId" = $1
		   AND COALESCE((EXTRACT(EPOCH FROM "updatedAt") * 1000)::bigint, 0) > $2`,
		[userId, sinceEpochMs],
	);

	return {
		serverTime,
		books: books.map((b) => ({
			id: Number(b.id),
			title: b.title,
			author: b.author,
			kind: b.kind,
			status: b.status,
			contentTier: b.contentTier ?? 'private_user',
			contentHash: b.contentHash,
			igbPath: b.igbPath,
			igbSize: b.igbSize !== null ? Number(b.igbSize) : null,
			igbDownloadUrl: null,
			updatedAt: Number(b.updatedAtMs),
			deletedAt: b.deletedAtMs !== null ? Number(b.deletedAtMs) : null,
		})),
		readingStates: readingStates.map((s) => ({
			bookId: Number(s.bookId),
			status: s.status,
			progressJson: s.progressJson,
			marksJson: s.marksJson,
			wordsJson: s.wordsJson,
			updatedAt: Number(s.updatedAtMs),
		})),
	};
}
