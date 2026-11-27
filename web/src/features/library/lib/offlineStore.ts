import type { Book, BookKind, BookReadingDocument } from '../../../entities/book/types';
import { decodeIgb1, encodeIgb1, type ContentTier } from './igb1';

export const OFFLINE_DB_NAME = 'ignit-offline-v2';
export const OFFLINE_DB_VERSION = 2;
export const OFFLINE_STORE_NAME = 'books';
export const OFFLINE_OUTBOX_STORE_NAME = 'sync_outbox';

export interface OfflineBookRecord {
	bookId: number;
	title: string;
	author: string;
	kind: BookKind;
	published?: boolean;
	contentTier?: ContentTier;
	pdfPages: number;
	bytes: number;
	kb: number;
	igbBytes?: number;
	savedAt: number;
	reading: BookReadingDocument;
}

export interface StoredOfflineBookEntry {
	bookId: number;
	title: string;
	author: string;
	kind: BookKind;
	published?: boolean;
	contentTier?: ContentTier;
	pdfPages: number;
	bytes: number;
	kb: number;
	igbBytes?: number;
	savedAt: number;
	igb?: Uint8Array;
	reading?: BookReadingDocument;
}

export interface OfflineBookPutInput {
	book: Pick<Book, 'id' | 'title' | 'author' | 'kind'> & {
		published?: boolean;
		contentTier?: ContentTier;
	};
	reading: BookReadingDocument;
	savedAt?: number;
}

export interface SyncOutboxEntry {
	id?: number;
	entityType: 'book' | 'reading_state';
	entityId: string;
	op: 'upsert' | 'delete';
	payloadJson: string;
	createdAt: number;
}

export interface OfflineStorageAdapter {
	put(record: StoredOfflineBookEntry): Promise<void>;
	get(bookId: number): Promise<StoredOfflineBookEntry | null>;
	list(): Promise<StoredOfflineBookEntry[]>;
	remove(bookId: number): Promise<void>;
	clear(): Promise<void>;
}

export interface OfflineBookStore {
	isAvailable(): boolean;
	put(input: OfflineBookPutInput): Promise<OfflineBookRecord>;
	get(bookId: number): Promise<OfflineBookRecord | null>;
	list(): Promise<OfflineBookRecord[]>;
	remove(bookId: number): Promise<void>;
	clear(): Promise<void>;
}

export function measureReadingBytes(reading: BookReadingDocument): number {
	const json = JSON.stringify(reading);
	if (typeof TextEncoder !== 'undefined') {
		return new TextEncoder().encode(json).byteLength;
	}
	return json.length;
}

export function bytesToKb(bytes: number): number {
	if (!Number.isFinite(bytes) || bytes <= 0) return 0;
	return Math.max(1, Math.round(bytes / 1024));
}

export function isIndexedDbAvailable(factory?: IDBFactory | null): boolean {
	if (factory !== undefined) return factory !== null;
	try {
		return typeof globalThis !== 'undefined' && typeof globalThis.indexedDB !== 'undefined' && globalThis.indexedDB !== null;
	} catch {
		return false;
	}
}

function openOfflineDb(factory: IDBFactory): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = factory.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(OFFLINE_STORE_NAME)) {
				db.createObjectStore(OFFLINE_STORE_NAME, { keyPath: 'bookId' });
			}
			if (!db.objectStoreNames.contains(OFFLINE_OUTBOX_STORE_NAME)) {
				db.createObjectStore(OFFLINE_OUTBOX_STORE_NAME, { keyPath: 'id', autoIncrement: true });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('No se pudo abrir IndexedDB.'));
	});
}

async function runTx<T>(
	factory: IDBFactory,
	mode: IDBTransactionMode,
	work: (store: IDBObjectStore) => IDBRequest<T>,
	storeName: string = OFFLINE_STORE_NAME,
): Promise<T> {
	const db = await openOfflineDb(factory);
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const finishError = (err: unknown) => {
			if (!settled) {
				settled = true;
				db.close();
				reject(err);
			}
		};

		try {
			const tx = db.transaction(storeName, mode);
			const store = tx.objectStore(storeName);
			const req = work(store);
			let resultValue: T;

			req.onsuccess = () => {
				resultValue = req.result;
			};
			req.onerror = () => {
				finishError(req.error ?? new Error('Error en IndexedDB.'));
			};
			tx.oncomplete = () => {
				if (!settled) {
					settled = true;
					db.close();
					resolve(resultValue);
				}
			};
			tx.onerror = () => {
				finishError(tx.error ?? new Error('Transacción de IndexedDB fallida.'));
			};
			tx.onabort = () => {
				finishError(tx.error ?? new Error('Transacción de IndexedDB abortada.'));
			};
		} catch (err) {
			finishError(err);
		}
	});
}

export function createIndexedDbAdapter(factory?: IDBFactory | null): OfflineStorageAdapter | null {
	const resolved = factory !== undefined ? factory : isIndexedDbAvailable() ? globalThis.indexedDB : null;
	if (!resolved) return null;

	return {
		async put(record) {
			await runTx(resolved, 'readwrite', (store) => store.put(record));
		},
		async get(bookId) {
			const found = await runTx<OfflineBookRecord | undefined>(resolved, 'readonly', (store) =>
				store.get(bookId),
			);
			return found ?? null;
		},
		async list() {
			const all = await runTx<OfflineBookRecord[]>(resolved, 'readonly', (store) => store.getAll());
			return Array.isArray(all) ? all : [];
		},
		async remove(bookId) {
			await runTx(resolved, 'readwrite', (store) => store.delete(bookId));
		},
		async clear() {
			await runTx(resolved, 'readwrite', (store) => store.clear());
		},
	};
}

export function createMemoryOfflineAdapter(): OfflineStorageAdapter {
	const map = new Map<number, StoredOfflineBookEntry>();
	return {
		async put(record) {
			map.set(record.bookId, record);
		},
		async get(bookId) {
			return map.get(bookId) ?? null;
		},
		async list() {
			return [...map.values()];
		},
		async remove(bookId) {
			map.delete(bookId);
		},
		async clear() {
			map.clear();
		},
	};
}

async function hydrateOfflineEntry(entry: StoredOfflineBookEntry): Promise<OfflineBookRecord> {
	const reading = entry.igb
		? await decodeIgb1(entry.igb, {
				bookId: String(entry.bookId),
				tier: 'public_open',
			})
		: entry.reading!;
	return {
		bookId: entry.bookId,
		title: entry.title,
		author: entry.author,
		kind: entry.kind,
		...(typeof entry.published === 'boolean' ? { published: entry.published } : {}),
		...(entry.contentTier ? { contentTier: entry.contentTier } : {}),
		pdfPages: entry.pdfPages,
		bytes: entry.bytes,
		kb: entry.kb,
		...(entry.igbBytes !== undefined ? { igbBytes: entry.igbBytes } : {}),
		savedAt: entry.savedAt,
		reading,
	};
}

export function createOfflineBookStore(adapter: OfflineStorageAdapter | null): OfflineBookStore {
	return {
		isAvailable() {
			return adapter !== null;
		},
		async put(input) {
			if (!adapter) {
				throw new Error('IndexedDB no está disponible en este navegador.');
			}
			if (input.book.contentTier === 'editorial_closed') {
				throw new Error(
					'Los libros con licencia editorial cerrada (Tier 3) no se pueden guardar en caché offline del navegador.',
				);
			}
			const bytes = measureReadingBytes(input.reading);
			const igb = await encodeIgb1(input.reading, {
				bookId: String(input.book.id),
				tier: 'public_open',
			});
			const entry: StoredOfflineBookEntry = {
				bookId: input.book.id,
				title: input.book.title,
				author: input.book.author,
				kind: input.book.kind,
				...(typeof input.book.published === 'boolean' ? { published: input.book.published } : {}),
				...(input.book.contentTier ? { contentTier: input.book.contentTier } : {}),
				pdfPages: Math.max(1, input.reading.pdfPages || 1),
				bytes,
				kb: bytesToKb(bytes),
				igbBytes: igb.byteLength,
				savedAt: input.savedAt ?? Date.now(),
				igb,
			};
			await adapter.put(entry);
			return {
				bookId: entry.bookId,
				title: entry.title,
				author: entry.author,
				kind: entry.kind,
				...(typeof entry.published === 'boolean' ? { published: entry.published } : {}),
				...(entry.contentTier ? { contentTier: entry.contentTier } : {}),
				pdfPages: entry.pdfPages,
				bytes: entry.bytes,
				kb: entry.kb,
				igbBytes: entry.igbBytes,
				savedAt: entry.savedAt,
				reading: input.reading,
			};
		},
		async get(bookId) {
			if (!adapter) return null;
			const entry = await adapter.get(bookId);
			return entry ? hydrateOfflineEntry(entry) : null;
		},
		async list() {
			if (!adapter) return [];
			const items = await adapter.list();
			const hydrated = await Promise.all(items.map(hydrateOfflineEntry));
			return hydrated.sort((a, b) => b.savedAt - a.savedAt);
		},
		async remove(bookId) {
			if (!adapter) return;
			await adapter.remove(bookId);
		},
		async clear() {
			if (!adapter) return;
			await adapter.clear();
		},
	};
}

export interface SyncOutboxStore {
	enqueue(entry: Omit<SyncOutboxEntry, 'id'>): Promise<number>;
	list(): Promise<SyncOutboxEntry[]>;
	remove(id: number): Promise<void>;
	clear(): Promise<void>;
}

export function createSyncOutboxStore(factory?: IDBFactory | null): SyncOutboxStore {
	const resolved = factory !== undefined ? factory : isIndexedDbAvailable() ? globalThis.indexedDB : null;
	if (!resolved) {
		const mem: SyncOutboxEntry[] = [];
		let nextId = 1;
		return {
			async enqueue(entry) {
				const id = nextId++;
				mem.push({ ...entry, id });
				return id;
			},
			async list() {
				return [...mem];
			},
			async remove(id) {
				const idx = mem.findIndex((e) => e.id === id);
				if (idx >= 0) mem.splice(idx, 1);
			},
			async clear() {
				mem.length = 0;
			},
		};
	}

	return {
		async enqueue(entry) {
			const id = await runTx<IDBValidKey>(
				resolved,
				'readwrite',
				(store) => store.add(entry),
				OFFLINE_OUTBOX_STORE_NAME,
			);
			return Number(id);
		},
		async list() {
			const rows = await runTx<SyncOutboxEntry[]>(
				resolved,
				'readonly',
				(store) => store.getAll(),
				OFFLINE_OUTBOX_STORE_NAME,
			);
			return Array.isArray(rows) ? rows : [];
		},
		async remove(id) {
			await runTx(
				resolved,
				'readwrite',
				(store) => store.delete(id),
				OFFLINE_OUTBOX_STORE_NAME,
			);
		},
		async clear() {
			await runTx(
				resolved,
				'readwrite',
				(store) => store.clear(),
				OFFLINE_OUTBOX_STORE_NAME,
			);
		},
	};
}

function getBrowserStore(): OfflineBookStore {
	return createOfflineBookStore(createIndexedDbAdapter());
}

export function isOfflineStorageAvailable(): boolean {
	return getBrowserStore().isAvailable();
}

export function putOfflineBook(input: OfflineBookPutInput): Promise<OfflineBookRecord> {
	return getBrowserStore().put(input);
}

export function getOfflineBook(bookId: number): Promise<OfflineBookRecord | null> {
	return getBrowserStore().get(bookId);
}

export function listOfflineBooks(): Promise<OfflineBookRecord[]> {
	return getBrowserStore().list();
}

export function removeOfflineBook(bookId: number): Promise<void> {
	return getBrowserStore().remove(bookId);
}

export function clearOfflineBooks(): Promise<void> {
	return getBrowserStore().clear();
}
