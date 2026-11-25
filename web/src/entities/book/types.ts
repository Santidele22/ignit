export type ReadingStatus = 'reading' | 'finished' | 'queued';

export type BookKind =
	| 'tecnico'
	| 'ciencia'
	| 'ficcion'
	| 'terror_scifi'
	| 'filosofia'
	| 'historia'
	| 'poesia'
	| 'no_tecnico';

export const BOOK_KIND_OPTIONS: ReadonlyArray<{ value: BookKind; label: string }> = [
	{ value: 'tecnico', label: 'Técnico' },
	{ value: 'ciencia', label: 'Ciencia' },
	{ value: 'ficcion', label: 'Ficción' },
	{ value: 'terror_scifi', label: 'Terror y Sci-Fi' },
	{ value: 'filosofia', label: 'Filosofía y Ensayo' },
	{ value: 'historia', label: 'Historia' },
	{ value: 'poesia', label: 'Poesía y Teatro' },
	{ value: 'no_tecnico', label: 'General' },
];

const BOOK_KIND_SET = new Set<string>(BOOK_KIND_OPTIONS.map((option) => option.value));

export function isBookKind(value: string | null | undefined): value is BookKind {
	return typeof value === 'string' && BOOK_KIND_SET.has(value);
}

export function parseBookKind(value: string | null | undefined): BookKind {
	return isBookKind(value) ? value : 'no_tecnico';
}

export function getBookKindLabel(kind: string | null | undefined): string {
	return BOOK_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? 'General';
}

export type BookMetricEvent = 'read_started' | 'offline_download' | 'cta_click';

export type Book = {
	id: number;
	title: string;
	author: string;
	description: string;
	status: ReadingStatus;
	statusLabel: string;
	kind: BookKind;
	review?: string;
	published: boolean;
	reviewStatus?: 'pending' | 'approved' | 'rejected' | null;
	coverUrl?: string | null;
	publisher?: string | null;
	translator?: string | null;
	illustrator?: string | null;
	isbn?: string | null;
	license?: string | null;
	ctaLabel?: string | null;
	ctaUrl?: string | null;
	hasFile?: boolean;
	fileSizeBytes?: number;
	isOwner?: boolean;
};

export type ReadingChunkType =
	| 'para'
	| 'heading'
	| 'verse'
	| 'toc'
	| 'quote'
	| 'list'
	| 'dedication'
	| 'meta'
	| 'caption'
	| 'code';

export type ReadingMood = 'espera' | 'polvo' | 'alerta' | 'niebla';

export type ReadingInlineMark = 'b' | 'i' | 'code';

export type ReadingInlineRun = {
	text: string;
	marks?: ReadingInlineMark[];
};

export type ReadingChunk = {
	id: string;
	type: ReadingChunkType;
	page: number;
	offset: number;
	text: string;
	mood: ReadingMood;
	cues: string[];
	level?: 1 | 2 | 3;
	runs?: ReadingInlineRun[];
	ordered?: boolean;
	items?: string[];
	align?: 'left' | 'center' | 'right';
};

export type BookReadingDocument = {
	bookId: string;
	pdfPages: number;
	ocrPending: boolean;
	extractorVersion?: number;
	chunks: ReadingChunk[];
};

export type ReadingMark = {
	id: string;
	kind: 'underline' | 'note' | 'lexicon';
	ink?: 'aka' | 'bronce' | 'tinta';
	anchor: string;
	text?: string;
	note?: string;
};

export type ReadingWord = {
	term: string;
	trans?: string;
	anchor?: string;
};

export type ReadingProgress = {
	page: number;
	pct: number;
	chunkId?: string;
};

export type BookReadingState = {
	bookId: string;
	status?: ReadingStatus;
	marks: ReadingMark[];
	words: ReadingWord[];
	progress: ReadingProgress;
};
