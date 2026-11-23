/**
 * Public barrel of the reading extractor.
 *
 * The implementation lives in the sibling `reading.*` modules; this file keeps
 * the original path and export surface stable for its consumers.
 */
export type {
  BookReadingDocument,
  BookReadingState,
  ReadingChunk,
  ReadingChunkType,
  ReadingInlineMark,
  ReadingInlineRun,
  ReadingMark,
  ReadingMood,
  ReadingProgress,
  ReadingWord,
} from './reading.types.js';
export { READING_EXTRACTOR_VERSION } from './reading.types.js';
export { classifyMoodAndCues } from './reading.mood.js';
export { extractPagesFromPdfBuffer } from './reading.pdf-text.js';
export { cleanPageTextsForExtraction } from './reading.noise.js';
export { classifyChunkType, splitPageIntoParagraphs } from './reading.chunks.js';
export { extractReadingFromPdftohtmlXml } from './reading.xml-blocks.js';
export { extractReadingFromPdf } from './reading.extract.js';
export {
  readBookReadingJson,
  readBookReadingState,
  readingJsonPath,
  readingStatePath,
  removeBookReadingArtifacts,
  writeBookReadingJson,
  writeBookReadingState,
} from './reading.state.js';