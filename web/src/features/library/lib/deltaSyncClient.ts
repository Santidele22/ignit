import type { SyncOutboxEntry, SyncOutboxStore } from './offlineStore';

export interface DeltaSyncPushAck {
	clientOpId: string;
	status: 'applied' | 'ignored_stale' | 'rejected';
	remoteId?: number;
	igbKey?: string;
	uploadUrl?: string | null;
}

export interface DeltaSyncPulledBook {
	id: number;
	title: string;
	author: string;
	kind: string;
	status: string;
	contentTier: string;
	contentHash: string | null;
	igbPath: string | null;
	igbSize: number | null;
	igbDownloadUrl: string | null;
	updatedAt: number;
	deletedAt: number | null;
}

export interface DeltaSyncPulledState {
	bookId: number;
	status: string;
	progressJson: string | null;
	marksJson: string | null;
	wordsJson: string | null;
	updatedAt: number;
}

export interface DeltaSyncPullResponse {
	serverTime: number;
	books: DeltaSyncPulledBook[];
	readingStates: DeltaSyncPulledState[];
}

export interface DeltaSyncTransport {
	push(items: Array<Record<string, unknown>>): Promise<{ serverTime: number; acked: DeltaSyncPushAck[] }>;
	pull(since: number): Promise<DeltaSyncPullResponse>;
}

export function createFetchSyncTransport(baseUrl = ''): DeltaSyncTransport {
	return {
		async push(items) {
			const res = await fetch(`${baseUrl}/api/sync/push`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items }),
			});
			if (!res.ok) throw new Error(`Sync push failed: ${res.status}`);
			return res.json();
		},
		async pull(since) {
			const res = await fetch(`${baseUrl}/api/sync/pull`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ since }),
			});
			if (!res.ok) throw new Error(`Sync pull failed: ${res.status}`);
			return res.json();
		},
	};
}

export interface DeltaSyncCallbacks {
	outbox: SyncOutboxStore;
	transport: DeltaSyncTransport;
	since: number;
	onUploadIgb?: (ack: DeltaSyncPushAck, entry: SyncOutboxEntry) => Promise<void>;
	onPulledBook?: (book: DeltaSyncPulledBook) => Promise<void>;
	onPulledState?: (state: DeltaSyncPulledState) => Promise<void>;
	onSetLastSyncAt?: (serverTime: number) => Promise<void>;
}

export interface DeltaSyncResult {
	pushed: number;
	pulledBooks: number;
	pulledStates: number;
	serverTime: number;
}

export async function runDeltaSync(opts: DeltaSyncCallbacks): Promise<DeltaSyncResult> {
	const pending = await opts.outbox.list();
	let pushed = 0;

	if (pending.length > 0) {
		const payloadItems = pending.map((entry) => {
			const parsed = JSON.parse(entry.payloadJson) as Record<string, unknown>;
			return {
				clientOpId: `outbox-${entry.id ?? entry.createdAt}`,
				entityType: entry.entityType,
				op: entry.op,
				bookId: Number.isFinite(Number(entry.entityId)) ? Number(entry.entityId) : undefined,
				updatedAt: entry.createdAt,
				payload: parsed,
			};
		});

		const pushRes = await opts.transport.push(payloadItems);
		for (let i = 0; i < pushRes.acked.length; i++) {
			const ack = pushRes.acked[i];
			const entry = pending[i];
			if (!ack || !entry) continue;
			if (ack.status === 'applied' || ack.status === 'ignored_stale') {
				if (ack.uploadUrl && opts.onUploadIgb) {
					await opts.onUploadIgb(ack, entry);
				}
				if (entry.id !== undefined) {
					await opts.outbox.remove(entry.id);
				}
				pushed++;
			}
		}
	}

	const pullRes = await opts.transport.pull(opts.since);
	if (opts.onPulledBook) {
		for (const book of pullRes.books) {
			await opts.onPulledBook(book);
		}
	}
	if (opts.onPulledState) {
		for (const state of pullRes.readingStates) {
			await opts.onPulledState(state);
		}
	}
	if (opts.onSetLastSyncAt) {
		await opts.onSetLastSyncAt(pullRes.serverTime);
	}

	return {
		pushed,
		pulledBooks: pullRes.books.length,
		pulledStates: pullRes.readingStates.length,
		serverTime: pullRes.serverTime,
	};
}
