import {
	BOOK_KIND_OPTIONS,
	getBookKindLabel,
	type Book,
	type BookKind,
} from '../../../entities/book/types';

export type CatalogKindFilter = '*' | BookKind;

export type SalaId = 'estudio' | 'despeje';

/**
 * The two rooms of the landing («Estudio Profesional» / «Despeje Literario»).
 *
 * They are a *view* over the existing `BookKind` domain — never a second
 * classification: `tecnico`/`ciencia` are studied, every other kind belongs to
 * the literary room. Adding a discipline (derecho, medicina, economía, diseño)
 * would be a `BookKind` change in `entities/book/types.ts` + the API enum, so
 * it stays out of the landing.
 */
export const SALA_KINDS: Record<SalaId, readonly BookKind[]> = {
	estudio: ['tecnico', 'ciencia'],
	despeje: ['ficcion', 'terror_scifi', 'filosofia', 'historia', 'poesia', 'no_tecnico'],
};

/** Kind each room opens the shelf with when its card is clicked. */
export const SALA_DEFAULT_KIND: Record<SalaId, BookKind> = {
	estudio: 'tecnico',
	despeje: 'ficcion',
};

export function salaForKind(kind: BookKind): SalaId {
	return SALA_KINDS.estudio.includes(kind) ? 'estudio' : 'despeje';
}

/** Counts the books of the current page per room (no invented totals). */
export function countSalaBooks(books: readonly Pick<Book, 'kind'>[]): Record<SalaId, number> {
	const counts: Record<SalaId, number> = { estudio: 0, despeje: 0 };
	for (const book of books) {
		counts[salaForKind(book.kind)] += 1;
	}
	return counts;
}

/**
 * The discipline chip row: one chip per real catalog kind plus the «all» chip.
 * Values are the `data-filtro` of the existing kind filter, so the client
 * runtime keeps a single source of state.
 */
export function buildDisciplineChips(): Array<{ value: CatalogKindFilter; label: string }> {
	return [
		{ value: '*', label: 'Todas las disciplinas' },
		...BOOK_KIND_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
	];
}

export interface ShelfBookInfo {
	id: number;
	idx: string;
	kind: BookKind;
	catLabel: string;
	title: string;
	author: string;
	meta: string;
}

export type ShelfItem =
	| { gap: number }
	| { stack: Array<{ w: number; h: number }> }
	| {
			w: number;
			h: number;
			tilt?: number;
			featured?: boolean;
			book?: ShelfBookInfo;
	  };

export interface ShelfRow {
	id: string;
	base: number;
	leftLabel: string;
	rightLabel: string;
	items: ShelfItem[];
}

export interface ShelfHudInfo {
	kicker: string;
	title: string;
	meta: string;
}

export interface ShelfLayout {
	shelves: ShelfRow[];
	defaultHud: ShelfHudInfo;
	isFallback: boolean;
}

export interface OfflineMeterState {
	count: number;
	totalKb: number;
	label: string;
	barPercent: number;
}

const MAX_METER_KB = 4200;
const FALLBACK_KB_BY_ID = [240, 310, 420, 560, 180, 380, 290, 470];

export function parseFileSizeBytes(raw: string | number | null | undefined): number | undefined {
	if (raw === null || raw === undefined || raw === '') return undefined;
	const parsed = typeof raw === 'number' ? raw : Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
	return Math.round(parsed);
}

export function bookSizeKb(book: Pick<Book, 'id' | 'fileSizeBytes'>): number {
	if (typeof book.fileSizeBytes === 'number' && Number.isFinite(book.fileSizeBytes) && book.fileSizeBytes > 0) {
		return Math.max(1, Math.round(book.fileSizeBytes / 1024));
	}
	const fallbackIdx = Math.abs(Math.trunc(book.id)) % FALLBACK_KB_BY_ID.length;
	return FALLBACK_KB_BY_ID[fallbackIdx]!;
}

export function formatSizeKb(kb: number): string {
	const safe = Math.max(0, Math.round(kb));
	if (safe >= 1024) {
		return `${(safe / 1024).toFixed(1)} MB`;
	}
	return `${safe} KB`;
}

export function kindLabel(kind: BookKind): string {
	return getBookKindLabel(kind);
}

export function normalizeSearchText(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

export function bookSearchIndex(book: Pick<Book, 'title' | 'author' | 'description'>): string {
	return normalizeSearchText(`${book.title} ${book.author} ${book.description}`);
}

export function filterCatalogBooks<T extends Pick<Book, 'kind' | 'title' | 'author' | 'description'>>(
	books: readonly T[],
	filter: CatalogKindFilter,
	query: string,
): T[] {
	const normalizedQuery = normalizeSearchText(query);
	return books.filter((book) => {
		const matchesKind = filter === '*' || book.kind === filter;
		if (!matchesKind) return false;
		if (!normalizedQuery) return true;
		return bookSearchIndex(book).includes(normalizedQuery);
	});
}

export function computeOfflineMeter(selectedKbList: readonly number[]): OfflineMeterState {
	let totalKb = 0;
	for (const kb of selectedKbList) {
		if (Number.isFinite(kb) && kb > 0) {
			totalKb += Math.round(kb);
		}
	}
	const count = selectedKbList.length;
	const unit = count === 1 ? 'libro' : 'libros';
	const barPercent =
		count === 0
			? 0
			: Math.min(100, Math.max(4, Math.round((totalKb / MAX_METER_KB) * 100)));

	return {
		count,
		totalKb,
		label: `${count} ${unit} · ${formatSizeKb(totalKb)}`,
		barPercent,
	};
}

export function coverVariantIndex(bookId: number): number {
	const safe = Math.abs(Math.trunc(bookId));
	return safe % 8;
}

function toShelfBookInfo(book: Book, index: number, isFeatured: boolean): ShelfBookInfo {
	const idx = String(index + 1).padStart(2, '0');
	const sizeLabel = formatSizeKb(bookSizeKb(book));
	const baseKind = kindLabel(book.kind).toUpperCase();
	return {
		id: book.id,
		idx,
		kind: book.kind,
		catLabel: isFeatured ? `${baseKind} · DESTACADO` : baseKind,
		title: book.title,
		author: book.author,
		meta: `${sizeLabel} · CLICK ↓`,
	};
}

/**
 * Builds the 3-shelf organic SVG composition from real published books.
 * Technical books populate shelf B, non-technical books populate shelves A and C,
 * and decorative silhouette volumes maintain the architectural rhythm of the
 * artboard regardless of catalog size (including an empty catalog fallback).
 */
export function buildShelfLayout(books: readonly Book[]): ShelfLayout {
	const featured = books[0];
	const capped = books.slice(0, 8);
	const indexed = capped.map((book, i) => toShelfBookInfo(book, i, i === 0));

	const isTechShelf = (k: BookKind) => k === 'tecnico' || k === 'ciencia';
	const nonTech = indexed.filter((b) => !isTechShelf(b.kind));
	const tech = indexed.filter((b) => isTechShelf(b.kind));

	const shelfABooks: ShelfBookInfo[] = [];
	const shelfBBooks: ShelfBookInfo[] = [...tech.slice(0, 3)];
	const shelfCBooks: ShelfBookInfo[] = [];

	nonTech.forEach((entry, idx) => {
		if (idx < 3) shelfABooks.push(entry);
		else if (shelfCBooks.length < 3) shelfCBooks.push(entry);
	});
	// Spill extra technical books onto shelf A/C if there are more than 3
	tech.slice(3).forEach((entry) => {
		if (shelfABooks.length < 3) shelfABooks.push(entry);
		else if (shelfCBooks.length < 3) shelfCBooks.push(entry);
	});

	const a0 = shelfABooks[0];
	const a1 = shelfABooks[1];
	const a2 = shelfABooks[2];
	const b0 = shelfBBooks[0];
	const b1 = shelfBBooks[1];
	const b2 = shelfBBooks[2];
	const c0 = shelfCBooks[0];
	const c1 = shelfCBooks[1];
	const c2 = shelfCBooks[2];

	const shelves: ShelfRow[] = [
		{
			id: 'shelf-a',
			base: 168,
			leftLabel: '01 / LECTURAS',
			rightLabel: 'ESTANTE A',
			items: [
				{ w: 20, h: 96 },
				{ w: 16, h: 84 },
				a1 ? { w: 26, h: 108, book: a1 } : { w: 24, h: 104 },
				{ w: 18, h: 92 },
				{ w: 22, h: 102 },
				a0
					? { w: 30, h: 118, featured: a0.id === featured?.id, book: a0 }
					: { w: 28, h: 112 },
				{ w: 17, h: 90 },
				a2 ? { w: 24, h: 106, book: a2 } : { w: 22, h: 100 },
				{ w: 19, h: 86 },
				{ gap: 36 },
				{ w: 25, h: 112, tilt: -11 },
				{ w: 18, h: 98 },
				{ w: 22, h: 90 },
				{ w: 20, h: 104 },
				{ w: 16, h: 88 },
				{ w: 24, h: 96 },
				{ w: 19, h: 102 },
				{ w: 21, h: 92 },
				{ w: 18, h: 86 },
			],
		},
		{
			id: 'shelf-b',
			base: 316,
			leftLabel: '02 / TÉCNICO',
			rightLabel: 'ESTANTE B',
			items: [
				{ w: 22, h: 104 },
				{ w: 18, h: 94 },
				b0
					? { w: 24, h: 108, featured: b0.id === featured?.id, book: b0 }
					: { w: 18, h: 92 },
				{ w: 24, h: 108 },
				b1 ? { w: 34, h: 120, book: b1 } : { w: 32, h: 116 },
				{ w: 20, h: 96 },
				b2 ? { w: 22, h: 102, book: b2 } : { w: 17, h: 88 },
				{ w: 22, h: 102 },
				{ w: 19, h: 92 },
				{ gap: 22 },
				{ stack: [{ w: 116, h: 18 }, { w: 102, h: 16 }] },
				{ gap: 20 },
				{ w: 20, h: 98 },
				{ w: 25, h: 110 },
				{ w: 18, h: 90 },
				{ w: 22, h: 100 },
			],
		},
		{
			id: 'shelf-c',
			base: 458,
			leftLabel: '03 / NO TÉCNICO & ARCHIVO',
			rightLabel: 'ESTANTE C',
			items: [
				{ w: 19, h: 94 },
				c0 ? { w: 23, h: 106, book: c0 } : { w: 23, h: 104 },
				{ w: 17, h: 88 },
				{ w: 21, h: 98 },
				{ w: 16, h: 86 },
				{ gap: 34 },
				{ w: 22, h: 104, tilt: 9 },
				{ w: 20, h: 96 },
				c1 ? { w: 25, h: 110, book: c1 } : { w: 24, h: 106 },
				{ w: 18, h: 92 },
				c2 ? { w: 23, h: 102, book: c2 } : { w: 21, h: 100 },
				{ w: 19, h: 88 },
				{ w: 24, h: 102 },
				{ w: 17, h: 94 },
				{ w: 22, h: 98 },
				{ w: 20, h: 90 },
				{ w: 24, h: 106 },
				{ w: 18, h: 88 },
			],
		},
	];

	if (!featured) {
		return {
			shelves,
			isFallback: true,
			defaultHud: {
				kicker: 'ESTANTE ABIERTO · VIGILIA',
				title: 'Catálogo listo para recibir tu primer libro',
				meta: 'SUBÍ UN PDF EN /BIBLIOTECA',
			},
		};
	}

	const firstInfo = indexed[0]!;
	return {
		shelves,
		isFallback: false,
		defaultHud: {
			kicker: `${firstInfo.idx} · ${firstInfo.catLabel}`,
			title: `${firstInfo.title} — ${firstInfo.author}`,
			meta: firstInfo.meta,
		},
	};
}
