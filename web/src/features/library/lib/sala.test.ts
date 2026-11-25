import { describe, expect, it } from 'vitest';
import { BOOK_KIND_OPTIONS, type Book } from '../../../entities/book/types';
import type { OfflineBookRecord } from './offlineStore';
import {
	SALA_ESTADOS,
	SALA_ESTADO_KINDS,
	SALA_TABS,
	computeStorageMeter,
	countSalaEstados,
	deriveAporteRows,
	filterSalaCatalog,
	filterSalaEstado,
	formatRelativeSync,
	mergeSalaBooks,
	nextSalaTabId,
	ownerReviewStage,
	readLocalReadingSnapshots,
	salaEstadoChips,
	salaEstadoOf,
	salaTabShortLabel,
	selectContinuityBook,
	validateBookUpload,
	type SalaTabId,
} from './sala';

function makeBook(overrides: Partial<Book> & Pick<Book, 'id' | 'title' | 'author'>): Book {
	return {
		description: 'Descripción del libro.',
		status: 'queued',
		statusLabel: 'En cola',
		kind: 'no_tecnico',
		published: true,
		hasFile: true,
		...overrides,
	};
}

function makeOffline(bookId: number, kb: number, pdfPages = 214): OfflineBookRecord {
	return {
		bookId,
		title: `Libro ${bookId}`,
		author: 'Autor',
		kind: 'no_tecnico',
		pdfPages,
		bytes: kb * 1024,
		kb,
		savedAt: 10_000,
		reading: { bookId: String(bookId), pdfPages, ocrPending: false, chunks: [] },
	};
}

describe('sala navigation metadata (desktop tablist + mobile PWA bottom bar)', () => {
	it('exposes the four ordered tabs with full desktop and short mobile labels', () => {
		expect(SALA_TABS).toEqual([
			{ id: 'device', label: 'En este dispositivo', shortLabel: 'Local' },
			{ id: 'library', label: 'Mi biblioteca', shortLabel: 'Biblioteca' },
			{ id: 'catalog', label: 'Catálogo', shortLabel: 'Catálogo' },
			{ id: 'submissions', label: 'Mis aportes', shortLabel: 'Aportes' },
		]);
	});

	it('maps each tab id to its short mobile label', () => {
		expect(salaTabShortLabel('device')).toBe('Local');
		expect(salaTabShortLabel('library')).toBe('Biblioteca');
		expect(salaTabShortLabel('catalog')).toBe('Catálogo');
		expect(salaTabShortLabel('submissions')).toBe('Aportes');
	});

	it('cycles the roving tab with wrap-around in both directions', () => {
		expect(nextSalaTabId('device', 1)).toBe('library');
		expect(nextSalaTabId('library', 1)).toBe('catalog');
		expect(nextSalaTabId('catalog', 1)).toBe('submissions');
		expect(nextSalaTabId('submissions', 1)).toBe('device');
		expect(nextSalaTabId('device', -1)).toBe('submissions');
		expect(nextSalaTabId('catalog', -1)).toBe('library');
		expect(nextSalaTabId('submissions', -1)).toBe('catalog');
		expect(nextSalaTabId('desconocido' as SalaTabId, 1)).toBe('device');
	});
});

describe('sala domain helpers', () => {
	it('reads only matching user reading snapshots from storage and ignores malformed entries', () => {
		const entries: Record<string, string> = {
			'ignit:book:u1:7': JSON.stringify({
				bookId: '7',
				progress: { page: 42, pct: 35, chunkId: 'c42' },
				updatedAt: 5000,
			}),
			'ignit:book:u2:7': JSON.stringify({
				bookId: '7',
				progress: { page: 99, pct: 90 },
				updatedAt: 9999,
			}),
			'ignit:book:u1:bad': '{not json',
			'other:key': 'ignored',
		};
		const keys = Object.keys(entries);
		const mockStorage = {
			length: keys.length,
			key: (i: number) => keys[i] ?? null,
			getItem: (k: string) => entries[k] ?? null,
		};

		const snapshots = readLocalReadingSnapshots(mockStorage, 'u1');
		expect(snapshots.size).toBe(1);
		expect(snapshots.get(7)).toEqual({
			bookId: 7,
			page: 42,
			pct: 35,
			chunkId: 'c42',
			updatedAt: 5000,
		});
	});

	it('merges owned and catalog books without duplicates and overlays offline + reading progress', () => {
		const owned = [
			makeBook({ id: 1, title: 'Tártaros', author: 'Buzzati', isOwner: true, status: 'reading', published: true }),
			makeBook({ id: 2, title: 'Borrador', author: 'Yo', isOwner: true, published: false, hasFile: false }),
		];
		const catalog = [
			makeBook({ id: 1, title: 'Tártaros', author: 'Buzzati', published: true }),
			makeBook({ id: 3, title: 'Sistemas', author: 'Tanenbaum', kind: 'tecnico', fileSizeBytes: 1_515_520 }),
		];
		const offline = [makeOffline(1, 566, 214)];
		const snapshots = new Map([
			[1, { bookId: 1, page: 98, pct: 46, updatedAt: 50_000 }],
		]);

		const merged = mergeSalaBooks({
			ownedBooks: owned,
			catalogBooks: catalog,
			offlineRecords: offline,
			localSnapshots: snapshots,
		});

		expect(merged).toHaveLength(3);
		const b1 = merged.find((b) => b.id === 1)!;
		expect(b1.isOwner).toBe(true);
		expect(b1.isOffline).toBe(true);
		expect(b1.inLibrary).toBe(true);
		expect(b1.sizeKb).toBe(566);
		expect(b1.pdfPages).toBe(214);
		expect(b1.progressPct).toBe(46);
		expect(b1.progressPage).toBe(98);

		const b3 = merged.find((b) => b.id === 3)!;
		expect(b3.inLibrary).toBe(false);
		expect(b3.catLabel).toBe('Técnico');
		expect(b3.sizeKb).toBe(1480);
	});

	it('selects the most recently read book for continuity and falls back cleanly', () => {
		const books = mergeSalaBooks({
			ownedBooks: [
				makeBook({ id: 1, title: 'Primero', author: 'A', isOwner: true, status: 'reading' }),
				makeBook({ id: 2, title: 'Reciente', author: 'B', isOwner: true, description: 'Una frase breve.' }),
			],
			catalogBooks: [],
			offlineRecords: [makeOffline(2, 180, 92)],
			localSnapshots: new Map([
				[1, { bookId: 1, page: 10, pct: 12, updatedAt: 10_000 }],
				[2, { bookId: 2, page: 44, pct: 48, updatedAt: 60_000 }],
			]),
		});

		const candidate = selectContinuityBook(books, 180_000);
		expect(candidate?.book.id).toBe(2);
		expect(candidate?.kickerLeft).toBe('retomar despeje · vigilia · General · offline');
		expect(candidate?.kickerRight).toBe('último sync: hace 2 min');
		expect(candidate?.progressLabel).toBe('Pág 44 / 92');
		expect(candidate?.href).toBe('/lecturas/2');
		expect(selectContinuityBook([])).toBeNull();
	});

	it('derives Mis aportes pipeline stages from published and hasFile without DB migration', () => {
		const books = mergeSalaBooks({
			ownedBooks: [
				makeBook({ id: 10, title: 'Sin PDF', author: 'A', isOwner: true, published: false, hasFile: false }),
				makeBook({ id: 11, title: 'Con PDF privado', author: 'B', isOwner: true, published: false, hasFile: true }),
				makeBook({ id: 12, title: 'Publicado', author: 'C', isOwner: true, published: true, hasFile: true }),
			],
			catalogBooks: [makeBook({ id: 13, title: 'De otro', author: 'D', published: true })],
			offlineRecords: [],
			localSnapshots: new Map(),
		});

		const rows = deriveAporteRows(books);
		expect(rows).toHaveLength(3);
		expect(rows.find((r) => r.book.id === 10)).toMatchObject({
			stage: 'standby',
			stageIndex: 1,
			previewHref: null,
		});
		expect(rows.find((r) => r.book.id === 11)).toMatchObject({
			stage: 'tested',
			stageIndex: 3,
			previewHref: '/lecturas/11',
		});
		expect(rows.find((r) => r.book.id === 12)).toMatchObject({
			stage: 'catalogo',
			stageIndex: 4,
			previewHref: '/lecturas/12',
		});
	});

	it('maps the backend review status to the owner-facing pipeline stage', () => {
		expect(ownerReviewStage('pending')).toBe('En revisión');
		expect(ownerReviewStage('rejected')).toBe('Rechazado');
		expect(ownerReviewStage('approved')).toBeNull();
		expect(ownerReviewStage(null)).toBeNull();
		expect(ownerReviewStage(undefined)).toBeNull();
		expect(ownerReviewStage('desconocido')).toBeNull();
	});

	it('computes real IndexedDB storage meter and filters catalog by kind + search', () => {
		expect(computeStorageMeter([])).toEqual({
			count: 0,
			totalKb: 0,
			badge: '0 KB usados',
			countLabel: '0 libros offline',
			barPercent: 0,
		});
		expect(computeStorageMeter([{ kb: 566 }, { kb: 180 }])).toEqual({
			count: 2,
			totalKb: 746,
			badge: '746 KB usados',
			countLabel: '2 libros offline',
			barPercent: 18,
		});
		expect(computeStorageMeter([{ kb: 1536 }]).countLabel).toBe('1 libro offline');

		const books = mergeSalaBooks({
			ownedBooks: [],
			catalogBooks: [
				makeBook({ id: 1, title: 'El desierto de los tártaros', author: 'Dino Buzzati', kind: 'no_tecnico' }),
				makeBook({ id: 2, title: 'Sistemas operativos', author: 'Tanenbaum', kind: 'tecnico' }),
			],
			offlineRecords: [],
			localSnapshots: new Map(),
		});
		expect(filterSalaCatalog(books, 'tecnico', '')).toHaveLength(1);
		expect(filterSalaCatalog(books, '*', 'tartaros').map((b) => b.id)).toEqual([1]);
	});

	it('formats relative sync times and validates PDF/EPUB uploads up to 50 MB', () => {
		expect(formatRelativeSync(undefined, 500_000)).toBe('sin sync local');
		expect(formatRelativeSync(495_000, 500_000)).toBe('último sync: recién');
		expect(formatRelativeSync(500_000 - 3 * 60_000, 500_000)).toBe('último sync: hace 3 min');

		const okPdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'libro.pdf', {
			type: 'application/pdf',
		});
		const okEpub = new File([new Uint8Array([0x50, 0x4b])], 'libro.epub', {
			type: 'application/epub+zip',
		});
		const epubByNameOnly = { name: 'libro.epub', type: '', size: 2048 } as File;
		const badExt = new File(['hola'], 'notas.txt', { type: 'text/plain' });
		const emptyPdf = new File([], 'vacio.pdf', { type: 'application/pdf' });

		expect(validateBookUpload(okPdf)).toBeNull();
		expect(validateBookUpload(okEpub)).toBeNull();
		expect(validateBookUpload(epubByNameOnly)).toBeNull();
		expect(validateBookUpload(null)).toMatch(/PDF/i);
		expect(validateBookUpload(null)).toMatch(/EPUB/i);
		expect(validateBookUpload(badExt)).toMatch(/EPUB/i);
		expect(validateBookUpload(emptyPdf)).toMatch(/vacío/i);
		expect(validateBookUpload(okPdf, 2)).toMatch(/límite/i);
	});

	it('enforces exact 50 MB boundary, clamps malformed snapshots, and keeps offline-only private books out of public catalog', () => {
		const exact = { name: 'DOC.PDF', type: '', size: 50 * 1024 * 1024 } as File;
		const over = { name: 'DOC.PDF', type: 'application/pdf', size: 50 * 1024 * 1024 + 1 } as File;
		expect(validateBookUpload(exact)).toBeNull();
		expect(validateBookUpload(over)).toBe('El archivo supera el límite de 50 MB.');

		const entries: Record<string, string> = {
			'ignit:book:u1:0': JSON.stringify({ progress: { page: 1, pct: 50 }, updatedAt: 1 }),
			'ignit:book:u1:5': JSON.stringify({ progress: { page: -4, pct: 180 }, updatedAt: 99 }),
		};
		const keys = Object.keys(entries);
		const snaps = readLocalReadingSnapshots(
			{ length: keys.length, key: (i) => keys[i] ?? null, getItem: (k) => entries[k] ?? null },
			'u1',
		);
		expect(snaps.get(5)).toEqual({ bookId: 5, page: 1, pct: 100, updatedAt: 99 });
		expect(computeStorageMeter([{ kb: 1 }]).barPercent).toBe(4);
		expect(computeStorageMeter([{ kb: 99999 }]).barPercent).toBe(100);

		const merged = mergeSalaBooks({
			ownedBooks: [],
			catalogBooks: [],
			offlineRecords: [makeOffline(77, 120)],
			localSnapshots: new Map(),
		});
		expect(merged[0]?.published).toBe(false);
	});
});

describe('sala estados — Estudio y Disciplina vs. Despeje Literario (S2)', () => {
	it('partitions the existing book kinds into exactly one estado, without a new taxonomy', () => {
		expect(SALA_ESTADOS.map((estado) => estado.id)).toEqual(['estudio', 'despeje']);
		expect(SALA_ESTADOS.map((estado) => estado.title)).toEqual([
			'Estudio y Disciplina',
			'Despeje Literario',
		]);

		const partitioned = BOOK_KIND_OPTIONS.map((option) => option.value).filter(
			(kind) => SALA_ESTADO_KINDS.estudio.includes(kind) && SALA_ESTADO_KINDS.despeje.includes(kind),
		);
		expect(partitioned).toEqual([]);
		expect([...SALA_ESTADO_KINDS.estudio, ...SALA_ESTADO_KINDS.despeje].sort()).toEqual(
			BOOK_KIND_OPTIONS.map((option) => option.value).sort(),
		);
	});

	it('maps técnico/ciencia to estudio and every literary/general kind to despeje', () => {
		expect(salaEstadoOf('tecnico')).toBe('estudio');
		expect(salaEstadoOf('ciencia')).toBe('estudio');
		for (const kind of ['ficcion', 'terror_scifi', 'filosofia', 'historia', 'poesia', 'no_tecnico']) {
			expect(salaEstadoOf(kind)).toBe('despeje');
		}
		// Unknown kinds fall back through the existing `parseBookKind`.
		expect(salaEstadoOf('desconocido')).toBe('despeje');
		expect(salaEstadoOf(null)).toBe('despeje');
	});

	it('counts the tomos of each estado over the merged sala books', () => {
		const books = mergeSalaBooks({
			ownedBooks: [makeBook({ id: 1, title: 'Sistemas', author: 'A', kind: 'tecnico', isOwner: true })],
			catalogBooks: [
				makeBook({ id: 2, title: 'Física', author: 'B', kind: 'ciencia' }),
				makeBook({ id: 3, title: 'Cuentos', author: 'C', kind: 'ficcion' }),
				makeBook({ id: 4, title: 'Poemas', author: 'D', kind: 'poesia' }),
			],
			offlineRecords: [],
			localSnapshots: new Map(),
		});

		expect(countSalaEstados(books)).toEqual({ estudio: 2, despeje: 2 });
		expect(countSalaEstados([])).toEqual({ estudio: 0, despeje: 0 });
	});

	it('filters the shelf by estado and keeps every book when no estado is selected', () => {
		const books = mergeSalaBooks({
			ownedBooks: [],
			catalogBooks: [
				makeBook({ id: 1, title: 'Sistemas', author: 'A', kind: 'tecnico' }),
				makeBook({ id: 2, title: 'Cuentos', author: 'C', kind: 'ficcion' }),
			],
			offlineRecords: [],
			localSnapshots: new Map(),
		});

		expect(filterSalaEstado(books, 'estudio').map((book) => book.id)).toEqual([1]);
		expect(filterSalaEstado(books, 'despeje').map((book) => book.id)).toEqual([2]);
		expect(filterSalaEstado(books, null).map((book) => book.id)).toEqual([1, 2]);
	});

	it('derives the domain chips from BOOK_KIND_OPTIONS', () => {
		expect(salaEstadoChips('estudio')).toEqual([
			{ value: '*', label: 'Todas las disciplinas' },
			{ value: 'tecnico', label: 'Técnico' },
			{ value: 'ciencia', label: 'Ciencia' },
		]);
		expect(salaEstadoChips('despeje').map((chip) => chip.value)).toEqual([
			'*',
			'ficcion',
			'terror_scifi',
			'filosofia',
			'historia',
			'poesia',
			'no_tecnico',
		]);
		expect(salaEstadoChips(null).map((chip) => chip.value)).toEqual([
			'*',
			...BOOK_KIND_OPTIONS.map((option) => option.value),
		]);
	});
});
