export type ReadingStatus = 'reading' | 'finished' | 'queued';

export type BookKind = 'tecnico' | 'no_tecnico';

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
