export const FRESH_TTL_MS = 60_000;

const EDGE_TTL_SECONDS = 604_800;
const EDGE_VERSION_KEY = 'content:version';

export interface EdgeCacheStore {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

type CacheOptions = {
	now?: () => number;
	kv?: EdgeCacheStore;
};

type Entry = {
	data: string;
	fetchedAt: number;
	version?: string;
};

type EdgeRecord = {
	v: string;
	data: string;
	fetchedAt: number;
};

const CACHEABLE_PATHS = new Set(['/books']);
const CACHEABLE_QUERIED_PATHS = new Set([
	'/books?offset=0&limit=8&published=true',
	'/books?limit=4&published=true',
]);
const CACHEABLE_PREFIXES = ['books/'];

const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<string>>();
const revalidating = new Set<string>();

let scheduleBackground: ((promise: Promise<unknown>) => void) | undefined;
let edgeStore: EdgeCacheStore | undefined;

export function setWaitUntil(schedule?: (promise: Promise<unknown>) => void): void {
	scheduleBackground = schedule;
}

export function setEdgeCacheStore(store?: EdgeCacheStore): void {
	edgeStore = store;
}

function edgeKey(path: string): string {
	return `content:entry:${path}`;
}

function runBackground(job: Promise<unknown>): void {
	if (scheduleBackground) {
		scheduleBackground(job);
	} else {
		void job;
	}
}

async function readEdgeVersion(kv: EdgeCacheStore): Promise<string> {
	try {
		return (await kv.get(EDGE_VERSION_KEY)) ?? '0';
	} catch {
		return '0';
	}
}

async function readEdgeEntry(
	kv: EdgeCacheStore,
	path: string,
): Promise<{ version: string; record: EdgeRecord | null }> {
	try {
		const [rawVersion, rawRecord] = await Promise.all([kv.get(EDGE_VERSION_KEY), kv.get(edgeKey(path))]);
		const version = rawVersion ?? '0';
		if (!rawRecord) return { version, record: null };

		const parsed = JSON.parse(rawRecord) as Partial<EdgeRecord> | null;
		if (
			parsed &&
			typeof parsed.v === 'string' &&
			typeof parsed.data === 'string' &&
			typeof parsed.fetchedAt === 'number'
		) {
			return { version, record: parsed as EdgeRecord };
		}
		return { version, record: null };
	} catch {
		return { version: '0', record: null };
	}
}

async function putEdgeRecord(
	kv: EdgeCacheStore,
	path: string,
	version: string,
	data: string,
	fetchedAt: number,
): Promise<void> {
	try {
		const payload: EdgeRecord = { v: version, data, fetchedAt };
		await kv.put(edgeKey(path), JSON.stringify(payload), { expirationTtl: EDGE_TTL_SECONDS });
	} catch {
		// KV write errors must never fail SSR or background revalidation.
	}
}

export function invalidateContentCache(options?: { kv?: EdgeCacheStore }): Promise<void> {
	entries.clear();
	inFlight.clear();
	revalidating.clear();

	const kv = options?.kv ?? edgeStore;
	if (!kv) {
		return Promise.resolve();
	}

	const nextVersion = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	return kv.put(EDGE_VERSION_KEY, nextVersion).catch(() => {});
}

export function cachedEntryCount(): number {
	return entries.size;
}

/**
 * Only public catalog reads (`/books` and `/books/:id`) may share the SSR
 * cache; authenticated reads (`?mine=true`), extracted reading chunks, user
 * reading state, and downloads always bypass it.
 */
export function cacheablePath(path: string): boolean {
	const clean = path.replace(/\/+$/, '');
	if (
		clean.includes('mine=true') ||
		clean.endsWith('/reading') ||
		clean.endsWith('/reading-state') ||
		clean.endsWith('/download') ||
		// The rotating demo showcase must honor deletions and rotation slots
		// immediately, never an edge-cached stale id (S4).
		clean.endsWith('/demo-featured')
	) {
		return false;
	}
	if (CACHEABLE_PATHS.has(clean) || CACHEABLE_QUERIED_PATHS.has(clean)) return true;

	const pathname = clean.split('?', 1)[0] ?? '';
	if (clean.includes('?')) return false;
	return CACHEABLE_PREFIXES.some((prefix) => pathname.startsWith(`/${prefix}`));
}

export async function cachedRead(path: string, fetcher: () => Promise<string>, options: CacheOptions = {}): Promise<string> {
	const now = options.now ?? (() => Date.now());
	const kv = options.kv ?? edgeStore;
	const timestamp = now();

	const entry = entries.get(path);
	if (entry && timestamp - entry.fetchedAt < FRESH_TTL_MS) {
		return entry.data;
	}

	if (entry) {
		scheduleStaleRevalidation(path, fetcher, now, kv, entry.version, entry.data);
		return entry.data;
	}

	let pending = inFlight.get(path);
	if (!pending) {
		pending = (async () => {
			let currentVersion = '0';
			if (kv) {
				const edge = await readEdgeEntry(kv, path);
				currentVersion = edge.version;
				if (edge.record && edge.record.v === currentVersion) {
					entries.set(path, {
						data: edge.record.data,
						fetchedAt: edge.record.fetchedAt,
						version: edge.record.v,
					});
					if (now() - edge.record.fetchedAt >= FRESH_TTL_MS) {
						scheduleStaleRevalidation(path, fetcher, now, kv, edge.record.v, edge.record.data);
					}
					return edge.record.data;
				}
			}

			const data = await fetcher();
			const fetchedAt = now();
			entries.set(path, { data, fetchedAt, version: currentVersion });
			if (kv) {
				runBackground(putEdgeRecord(kv, path, currentVersion, data, fetchedAt));
			}
			return data;
		})().finally(() => {
			inFlight.delete(path);
		});
		inFlight.set(path, pending);
	}

	return pending;
}

function scheduleStaleRevalidation(
	path: string,
	fetcher: () => Promise<string>,
	now: () => number,
	kv: EdgeCacheStore | undefined,
	previousVersion: string | undefined,
	previousData: string | undefined,
): void {
	if (revalidating.has(path)) return;

	revalidating.add(path);
	const job = fetcher()
		.then(async (data) => {
			const fetchedAt = now();
			const latestVersion = kv ? await readEdgeVersion(kv) : '0';
			entries.set(path, { data, fetchedAt, version: latestVersion });
			if (kv && (data !== previousData || previousVersion !== latestVersion)) {
				await putEdgeRecord(kv, path, latestVersion, data, fetchedAt);
			}
		})
		.catch(() => {})
		.finally(() => {
			revalidating.delete(path);
		});

	runBackground(job);
}
