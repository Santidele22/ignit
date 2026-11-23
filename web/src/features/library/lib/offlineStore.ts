import type { Book, BookKind, BookReadingDocument } from '../../../entities/book/types';

export const OFFLINE_DB_NAME = 'ignit-offline-v1';
export const OFFLINE_DB_VERSION = 1;
export const OFFLINE_STORE_NAME = 'books';

export interface OfflineBookRecord {
	bookId: number;
	title: string;
	author: string;
	kind: BookKind;
	pdfPages: number;
	bytes: number;
	kb: number;
	savedAt: number;
	reading: BookReadingDocument;
}

export interface OfflineBookPutInput {
	book: Pick<Book, 'id' | 'title' | 'author' | 'kind'>;
	reading: BookReadingDocument;
	savedAt?: number;
}

export interface OfflineStorageAdapter {
	put(record: OfflineBookRecord): Promise<void>;
	get(bookId: number): Promise<OfflineBookRecord | null>;
	list(): Promise<OfflineBookRecord[]>;
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
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('No se pudo abrir IndexedDB.'));
	});
}

function runTx<T>(
	factory: IDBFactory,
	mode: IDBTransactionMode,
	work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	return openOfflineDb(factory).then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				let settled = false;
				const tx = db.transaction(OFFLINE_STORE_NAME, mode);
				const store = tx.objectStore(OFFLINE_STORE_NAME);
				const req = work(store);
				let resultValue: T;

				req.onsuccess = () => {
					resultValue = req.result;
				};
				req.onerror = () => {
					if (!settled) {
						settled = true;
						db.close();
						reject(req.error ?? new Error('Error en IndexedDB.'));
					}
				};
				tx.oncomplete = () => {
					if (!settled) {
						settled = true;
						db.close();
						resolve(resultValue);
					}
				};
				tx.onerror = () => {
					if (!settled) {
						settled = true;
						db.close();
						reject(tx.error ?? new Error('Transacción de IndexedDB fallida.'));
					}
				};
				tx.onabort = () => {
					if (!settled) {
						settled = true;
						db.close();
						reject(tx.error ?? new Error('Transacción de IndexedDB abortada.'));
					}
				};
			}),
	);
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
	const map = new Map<number, OfflineBookRecord>();
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

export function createOfflineBookStore(adapter: OfflineStorageAdapter | null): OfflineBookStore {
	return {
		isAvailable() {
			return adapter !== null;
		},
		async put(input) {
			if (!adapter) {
				throw new Error('IndexedDB no está disponible en este navegador.');
			}
			const bytes = measureReadingBytes(input.reading);
			const record: OfflineBookRecord = {
				bookId: input.book.id,
				title: input.book.title,
				author: input.book.author,
				kind: input.book.kind,
				pdfPages: Math.max(1, input.reading.pdfPages || 1),
				bytes,
				kb: bytesToKb(bytes),
				savedAt: input.savedAt ?? Date.now(),
				reading: input.reading,
			};
			await adapter.put(record);
			return record;
		},
		async get(bookId) {
			if (!adapter) return null;
			return adapter.get(bookId);
		},
		async list() {
			if (!adapter) return [];
			const items = await adapter.list();
			return [...items].sort((a, b) => b.savedAt - a.savedAt);
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
