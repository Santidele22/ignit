export const READING_EXTRACTOR_VERSION = 3;

export type ReadingChunkType =
  | 'para'
  | 'dialogue'
  | 'heading'
  | 'verse'
  | 'toc'
  | 'quote'
  | 'list'
  | 'dedication'
  | 'meta'
  | 'caption'
  | 'code';

export type ReadingInlineMark = 'b' | 'i' | 'code';

export interface ReadingInlineRun {
  text: string;
  marks?: ReadingInlineMark[];
}

export type ReadingMood = 'espera' | 'polvo' | 'alerta' | 'niebla';

export interface ReadingChunk {
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
}

export interface AiClutterItem {
  id: string;
  page: number;
  text: string;
  reason: string;
  action: 'dropped' | 'recommended';
}

export interface AiRefinementSummary {
  applied: boolean;
  model?: string;
  passes?: number;
  reclassified: number;
  merged: number;
  dropped: number;
  clutter?: AiClutterItem[];
}

export interface BookReadingDocument {
  bookId: string;
  pdfPages: number;
  ocrPending: boolean;
  extractorVersion?: number;
  refinedByAi?: boolean;
  aiRefinement?: AiRefinementSummary | null;
  chunks: ReadingChunk[];
}

export interface ReadingMark {
  id: string;
  kind: 'underline' | 'note' | 'lexicon';
  ink?: 'aka' | 'bronce' | 'tinta';
  anchor: string;
  text?: string;
  note?: string;
}

export interface ReadingWord {
  term: string;
  trans?: string;
  anchor?: string;
}

export interface ReadingProgress {
  page: number;
  pct: number;
  chunkId?: string;
}

export interface BookReadingState {
  bookId: string;
  status?: 'reading' | 'finished' | 'queued';
  marks: ReadingMark[];
  words: ReadingWord[];
  progress: ReadingProgress;
}

export interface PdfFontSpec {
  id: string;
  size: number;
  family: string;
  color: string;
  isBold: boolean;
  isItalic: boolean;
  isMono: boolean;
}

export interface PdfXmlSpan {
  top: number;
  left: number;
  width: number;
  height: number;
  fontId: string;
  fontSize: number;
  runs: ReadingInlineRun[];
  text: string;
  isBold: boolean;
  isItalic: boolean;
  isMono: boolean;
}

export interface PdfLineSegment {
  left: number;
  right: number;
  text: string;
  runs: ReadingInlineRun[];
  fontSize: number;
  isBold: boolean;
  isItalic: boolean;
  isMono: boolean;
}

export interface PdfLine {
  top: number;
  bottom: number;
  left: number;
  right: number;
  text: string;
  runs: ReadingInlineRun[];
  segments: PdfLineSegment[];
  fontSize: number;
  isBold: boolean;
  isItalic: boolean;
  isMono: boolean;
  isCentered: boolean;
}

export interface PdfXmlPage {
  number: number;
  width: number;
  height: number;
  spans: PdfXmlSpan[];
}

export interface RawExtractedBlock {
  type: ReadingChunkType;
  page: number;
  offset: number;
  text: string;
  runs?: ReadingInlineRun[];
  level?: 1 | 2 | 3;
  ordered?: boolean;
  items?: string[];
  align?: 'left' | 'center' | 'right';
  endsWithSentencePunct: boolean;
  startsLowercase: boolean;
  firstLineIndented: boolean;
}
