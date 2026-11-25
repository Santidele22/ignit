import { isOpenLicense } from '../../../entities/book/open-licenses';
import type { Book, BookKind } from '../../../entities/book/types';
import {
	bookSizeKb,
	coverVariantIndex,
	filterCatalogBooks,
	formatSizeKb,
	kindLabel,
	type CatalogKindFilter,
} from '../../landing/lib/catalog';
import type { OfflineBookRecord } from './offlineStore';

export type SalaTabId = 'device' | 'library' | 'catalog' | 'submissions';

/**
 * Ordered metadata of the single `role="tablist"` of the sala (S1).
 *
 * `label` is the full desktop label (`> 768px`); `shortLabel` is the compact
 * label the same tab renders inside the mobile PWA bottom bar (`<= 768px`), so
 * the CSS only has to swap which one is displayed and both stay in one place.
 */
export interface SalaTabMeta {
	id: SalaTabId;
	label: string;
	shortLabel: string;
}

export const SALA_TABS: readonly SalaTabMeta[] = [
	{ id: 'device', label: 'En este dispositivo', shortLabel: 'Local' },
	{ id: 'library', label: 'Mi biblioteca', shortLabel: 'Biblioteca' },
	{ id: 'catalog', label: 'Catálogo', shortLabel: 'Catálogo' },
	{ id: 'submissions', label: 'Mis aportes', shortLabel: 'Aportes' },
];

/** Short mobile label of a tab (bottom-bar caption). */
export function salaTabShortLabel(id: SalaTabId): string {
	const tab = SALA_TABS.find((entry) => entry.id === id);
	return tab ? tab.shortLabel : id;
}

/**
 * Next tab id for the roving tablist: `delta` of `1`/`-1` from the
 * `ArrowRight`/`ArrowLeft` keys, wrapping around. Unknown ids fall back to the
 * first tab so the tablist can never point at a non-existent panel.
 */
export function nextSalaTabId(current: SalaTabId, delta: number): SalaTabId {
	const count = SALA_TABS.length;
	const index = SALA_TABS.findIndex((entry) => entry.id === current);
	if (index === -1) return SALA_TABS[0]!.id;
	const step = Number.isFinite(delta) ? Math.trunc(delta) : 1;
	const next = (((index + step) % count) + count) % count;
	return SALA_TABS[next]!.id;
}

export type AporteStage = 'standby' | 'en_curso' | 'tested' | 'catalogo';

/** Owner-facing label of the backend `reviewStatus` column (S4/S5). */
export type OwnerReviewStage = 'En revisión' | 'Rechazado';

/**
 * Maps the backend review state to the label «Mis aportes» shows to the owner.
 *
 * Deliberate deferral (T3): the presenter strips `reviewStatus` from owner
 * payloads (`46de114`), so `deriveAporteRows` cannot see it yet and keeps its
 * existing stages untouched. This helper is ready for the day the backend
 * exposes the review state to owners: `pending` → «En revisión», `rejected` →
 * «Rechazado», and `approved`/unknown/absent → `null` (published approval is
 * already represented by the `catalogo` stage).
 */
export function ownerReviewStage(
	reviewStatus: string | null | undefined,
): OwnerReviewStage | null {
	if (reviewStatus === 'pending') return 'En revisión';
	if (reviewStatus === 'rejected') return 'Rechazado';
	return null;
}

export interface LocalReadingSnapshot {
	bookId: number;
	page: number;
	pct: number;
	chunkId?: string;
	updatedAt: number;
}

export interface SalaBook extends Book {
	idx: string;
	catLabel: string;
	isOffline: boolean;
	inLibrary: boolean;
	progressPct: number;
	progressPage: number;
	pdfPages?: number;
	sizeKb: number;
	lastReadAt?: number;
	coverVariant: number;
}

export interface ContinuityCandidate {
	book: SalaBook;
	kickerLeft: string;
	kickerRight: string;
	quote: string;
	progressLabel: string;
	progressPct: number;
	href: string;
}

export interface AporteRow {
	book: SalaBook;
	stage: AporteStage;
	stageIndex: 1 | 2 | 3 | 4;
	statusTag: string;
	note: string;
	metaLine: string;
	previewHref: string | null;
}

export interface StorageMeterView {
	count: number;
	totalKb: number;
	badge: string;
	countLabel: string;
	barPercent: number;
}

export const MAX_PDF_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_STORAGE_METER_KB = 4200;

export function readLocalReadingSnapshots(
	storage: Pick<Storage, 'length' | 'key' | 'getItem'> | null | undefined,
	userId: string,
): Map<number, LocalReadingSnapshot> {
	const result = new Map<number, LocalReadingSnapshot>();
	if (!storage || !userId) return result;

	const prefix = `ignit:book:${userId}:`;
	for (let i = 0; i < storage.length; i++) {
		const key = storage.key(i);
		if (!key || !key.startsWith(prefix)) continue;
		const rawId = key.slice(prefix.length);
		const bookId = Number(rawId);
		if (!Number.isInteger(bookId) || bookId <= 0) continue;

		const raw = storage.getItem(key);
		if (!raw) continue;
		try {
			const parsed = JSON.parse(raw) as {
				progress?: { page?: unknown; pct?: unknown; chunkId?: unknown };
				updatedAt?: unknown;
			};
			const page =
				typeof parsed.progress?.page === 'number' && Number.isFinite(parsed.progress.page)
					? Math.max(1, Math.round(parsed.progress.page))
					: 1;
			const pct =
				typeof parsed.progress?.pct === 'number' && Number.isFinite(parsed.progress.pct)
					? Math.min(100, Math.max(0, Math.round(parsed.progress.pct)))
					: 0;
			const updatedAt =
				typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
					? parsed.updatedAt
					: 0;
			const chunkId =
				typeof parsed.progress?.chunkId === 'string' && parsed.progress.chunkId.length > 0
					? parsed.progress.chunkId
					: undefined;
			result.set(bookId, {
				bookId,
				page,
				pct,
				...(chunkId ? { chunkId } : {}),
				updatedAt,
			});
		} catch {
			// Ignore corrupted localStorage snapshots.
		}
	}

	return result;
}

export interface MergeSalaBooksInput {
	ownedBooks: readonly Book[];
	catalogBooks: readonly Book[];
	offlineRecords: readonly OfflineBookRecord[];
	localSnapshots: ReadonlyMap<number, LocalReadingSnapshot>;
}

export function mergeSalaBooks(input: MergeSalaBooksInput): SalaBook[] {
	const offlineById = new Map<number, OfflineBookRecord>();
	for (const rec of input.offlineRecords) {
		offlineById.set(rec.bookId, rec);
	}

	const mergedById = new Map<number, Book>();
	for (const book of input.catalogBooks) {
		mergedById.set(book.id, book);
	}
	for (const book of input.ownedBooks) {
		mergedById.set(book.id, { ...book, isOwner: true });
	}

	// Preserve offline books even if currently unreachable from API.
	for (const rec of input.offlineRecords) {
		if (!mergedById.has(rec.bookId)) {
			mergedById.set(rec.bookId, {
				id: rec.bookId,
				title: rec.title,
				author: rec.author,
				description: '',
				status: 'reading',
				statusLabel: 'Leyendo',
				kind: rec.kind,
				published: rec.published === true,
				hasFile: true,
				fileSizeBytes: rec.bytes,
			});
		}
	}

	const ordered = [...mergedById.values()];
	return ordered.map((book, index) => {
		const offline = offlineById.get(book.id);
		const snap = input.localSnapshots.get(book.id);
		const isOffline = Boolean(offline);
		const progressPct = snap
			? snap.pct
			: book.status === 'finished'
				? 100
				: 0;
		const progressPage = snap ? snap.page : 0;
		const isUnapproved = book.reviewStatus === 'pending' || book.reviewStatus === 'rejected';
		// Owner's own books (including private personal PDFs) always stay visible
		// in "Mi biblioteca" and HeroDash continuity for Modo Vigilia reading.
		const inLibrary = Boolean(book.isOwner || (!isUnapproved && (isOffline || snap)));
		const sizeKb = offline ? offline.kb : bookSizeKb(book);

		return {
			...book,
			published: Boolean(book.published && !isUnapproved),
			idx: String(index + 1).padStart(2, '0'),
			catLabel: kindLabel(book.kind),
			isOffline,
			inLibrary,
			progressPct,
			progressPage,
			...(offline?.pdfPages ? { pdfPages: offline.pdfPages } : {}),
			sizeKb,
			...(snap?.updatedAt ? { lastReadAt: snap.updatedAt } : {}),
			coverVariant: coverVariantIndex(book.id),
		};
	});
}

export function formatRelativeSync(timestampMs: number | undefined, nowMs = Date.now()): string {
	if (!timestampMs || !Number.isFinite(timestampMs) || timestampMs <= 0) {
		return 'sin sync local';
	}
	const diffMs = Math.max(0, nowMs - timestampMs);
	const diffMin = Math.floor(diffMs / 60_000);
	if (diffMin < 1) return 'último sync: recién';
	if (diffMin < 60) return `último sync: hace ${diffMin} min`;
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return `último sync: hace ${diffHr} h`;
	const diffDays = Math.floor(diffHr / 24);
	return `último sync: hace ${diffDays} d`;
}

function buildQuote(book: SalaBook): string {
	const raw = (book.review || book.description || '').trim();
	if (!raw) {
		return '«Abrí Vigilia para retomar exactamente en la página donde dejaste la lectura.»';
	}
	const trimmed = raw.length > 170 ? `${raw.slice(0, 167).trimEnd()}…` : raw;
	return `«${trimmed}»`;
}

export function selectContinuityBook(
	books: readonly SalaBook[],
	nowMs = Date.now(),
): ContinuityCandidate | null {
	if (books.length === 0) return null;

	const scored = [...books].sort((a, b) => {
		const aRead = a.lastReadAt ?? 0;
		const bRead = b.lastReadAt ?? 0;
		if (aRead !== bRead) return bRead - aRead;

		const aActive = a.status === 'reading' ? 1 : 0;
		const bActive = b.status === 'reading' ? 1 : 0;
		if (aActive !== bActive) return bActive - aActive;

		const aOff = a.isOffline ? 1 : 0;
		const bOff = b.isOffline ? 1 : 0;
		if (aOff !== bOff) return bOff - aOff;

		const aLib = a.inLibrary ? 1 : 0;
		const bLib = b.inLibrary ? 1 : 0;
		if (aLib !== bLib) return bLib - aLib;

		return a.id - b.id;
	});

	const book = scored[0]!;
	const hasProgress = book.progressPage > 0 || book.progressPct > 0 || book.status === 'reading';
	const kickerLeft = hasProgress
		? book.isOffline
			? 'continuar leyendo · disponible offline'
			: 'continuar leyendo · en línea'
		: book.isOffline
			? 'listo para leer · disponible offline'
			: 'empezar lectura · en tu biblioteca';

	const progressLabel =
		book.progressPage > 0
			? book.pdfPages
				? `Pág ${book.progressPage} / ${book.pdfPages}`
				: `Pág ${book.progressPage}`
			: book.status === 'finished'
				? 'Lectura completada'
				: 'Sin comenzar';

	return {
		book,
		kickerLeft,
		kickerRight: formatRelativeSync(book.lastReadAt, nowMs),
		quote: buildQuote(book),
		progressLabel,
		progressPct: book.progressPct,
		href: `/lecturas/${book.id}`,
	};
}

export function deriveAporteRows(books: readonly SalaBook[]): AporteRow[] {
	return books
		.filter((book) => book.isOwner === true)
		.map((book) => {
			const sizeText = formatSizeKb(book.sizeKb);
			const metaLine = `${book.author} · Categoría: ${book.catLabel} · ${sizeText}`;

			if (book.published) {
				return {
					book,
					stage: 'catalogo',
					stageIndex: 4,
					statusTag: 'PUBLICADO',
					note: 'Publicado en el catálogo comunitario. Disponible para lectura en Vigilia y descarga offline.',
					metaLine,
					previewHref: `/lecturas/${book.id}`,
				};
			}

			if (book.hasFile) {
				const openLicense = isOpenLicense(book.license);
				return {
					book,
					stage: 'tested',
					stageIndex: 3,
					statusTag: openLicense ? 'EN REVISIÓN' : 'PRIVADO',
					note: openLicense
						? 'PDF cargado en tu biblioteca privada. Postulado al catálogo público: pendiente de aprobación administrativa.'
						: 'PDF cargado y listo en tu biblioteca privada para leer en Modo Vigilia (solo visible para vos).',
					metaLine,
					previewHref: `/lecturas/${book.id}`,
				};
			}

			return {
				book,
				stage: 'standby',
				stageIndex: 1,
				statusTag: 'PENDIENTE PDF',
				note: 'Registro creado sin archivo PDF adjunto. Subí el PDF desde Editar para habilitar la lectura en Vigilia.',
				metaLine,
				previewHref: null,
			};
		});
}

export function computeStorageMeter(
	offlineRecords: readonly Pick<OfflineBookRecord, 'kb'>[],
): StorageMeterView {
	let totalKb = 0;
	for (const rec of offlineRecords) {
		if (Number.isFinite(rec.kb) && rec.kb > 0) {
			totalKb += Math.round(rec.kb);
		}
	}
	const count = offlineRecords.length;
	const unit = count === 1 ? 'libro' : 'libros';
	const barPercent =
		count === 0
			? 0
			: Math.min(100, Math.max(4, Math.round((totalKb / MAX_STORAGE_METER_KB) * 100)));

	return {
		count,
		totalKb,
		badge: `${formatSizeKb(totalKb)} usados`,
		countLabel: `${count} ${unit} en tu dispositivo`,
		barPercent,
	};
}

export function filterSalaCatalog(
	books: readonly SalaBook[],
	filter: CatalogKindFilter,
	query: string,
): SalaBook[] {
	return filterCatalogBooks(books, filter, query);
}

export function validatePdfUpload(
	file: File | null | undefined,
	maxBytes = MAX_PDF_UPLOAD_BYTES,
): string | null {
	if (!file) {
		return 'Seleccioná un archivo PDF para subir.';
	}
	const isPdfMime = file.type === 'application/pdf';
	const isPdfName = file.name.toLowerCase().endsWith('.pdf');
	if (!isPdfMime && !isPdfName) {
		return 'El archivo debe ser un PDF válido (.pdf).';
	}
	if (file.size <= 0) {
		return 'El archivo PDF está vacío.';
	}
	if (file.size > maxBytes) {
		const maxMb = Math.round(maxBytes / (1024 * 1024));
		return `El archivo supera el límite de ${maxMb} MB.`;
	}
	return null;
}

export function kindFromValue(raw: string): BookKind {
	return raw === 'tecnico' ? 'tecnico' : 'no_tecnico';
}

export { formatSizeKb };
