import type {
  AiRefinementSummary,
  BookReadingDocument,
  ReadingChunkType,
} from '../reading/reading.types.js';

export type RefinerReclassifyPatch = {
  op: 'reclassify';
  id: string;
  type: ReadingChunkType;
  level?: 1 | 2 | 3;
  align?: 'left' | 'center' | 'right';
};

export type RefinerMergePatch = {
  op: 'merge';
  id: string;
};

export type RefinerDropPatch = {
  op: 'drop';
  id: string;
};

export type RefinerPatch =
  | RefinerReclassifyPatch
  | RefinerMergePatch
  | RefinerDropPatch;

export type RefinementResult = {
  document: BookReadingDocument;
  summary: AiRefinementSummary;
};
