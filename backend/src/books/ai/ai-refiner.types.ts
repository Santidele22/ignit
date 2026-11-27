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
  reason?: string;
};

export type RefinerRecommendDropPatch = {
  op: 'recommend_drop';
  id: string;
  reason: string;
};

export type RefinerSplitPatch = {
  op: 'split';
  id: string;
  splitAfterIndex: number;
  nextType?: ReadingChunkType;
};

export type RefinerFlagCorruptPatch = {
  op: 'flag_corrupt';
  id: string;
  reason: string;
};

export type RefinerPatch =
  | RefinerReclassifyPatch
  | RefinerMergePatch
  | RefinerDropPatch
  | RefinerRecommendDropPatch
  | RefinerSplitPatch
  | RefinerFlagCorruptPatch;

export type RefinementResult = {
  document: BookReadingDocument;
  summary: AiRefinementSummary;
};
