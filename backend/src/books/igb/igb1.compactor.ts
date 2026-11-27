import type { BookReadingDocument, ReadingChunk } from '../reading/reading.types.js';
import type { CompactReadingChunk, CompactReadingDocument } from './igb1.types.js';

function compactChunk(chunk: ReadingChunk): CompactReadingChunk {
  const out: CompactReadingChunk = {
    i: chunk.id,
    p: chunk.page,
    o: chunk.offset,
    x: chunk.text,
  };
  if (chunk.type !== 'para') out.t = chunk.type;
  if (chunk.mood !== 'espera') out.m = chunk.mood;
  if (chunk.cues && chunk.cues.length > 0) out.q = chunk.cues;
  if (chunk.level !== undefined) out.l = chunk.level;
  if (chunk.runs && chunk.runs.length > 0) out.r = chunk.runs;
  if (chunk.ordered === true) out.ord = 1;
  if (chunk.items && chunk.items.length > 0) out.it = chunk.items;
  if (chunk.align === 'center' || chunk.align === 'right') out.a = chunk.align;
  return out;
}

function expandChunk(compact: CompactReadingChunk): ReadingChunk {
  const out: ReadingChunk = {
    id: compact.i,
    type: compact.t ?? 'para',
    page: compact.p,
    offset: compact.o,
    text: compact.x,
    mood: compact.m ?? 'espera',
    cues: compact.q ?? [],
    align: compact.a ?? 'left',
  };
  if (compact.l !== undefined) out.level = compact.l;
  if (compact.r !== undefined) out.runs = compact.r;
  if (compact.ord === 1) out.ordered = true;
  if (compact.it !== undefined) out.items = compact.it;
  return out;
}

/**
 * Compacts a BookReadingDocument by omitting default chunk fields and
 * stripping audit-only aiRefinement/clutter metadata before compression.
 */
export function compactReadingDocument(doc: BookReadingDocument): CompactReadingDocument {
  const out: CompactReadingDocument = {
    v: 1,
    b: doc.bookId,
    p: doc.pdfPages,
    c: doc.chunks.map(compactChunk),
  };
  if (doc.ocrPending) out.o = 1;
  if (doc.extractorVersion !== undefined) out.ev = doc.extractorVersion;
  if (doc.refinedByAi) out.ai = 1;
  return out;
}

/**
 * Restores a CompactReadingDocument back into a standard BookReadingDocument.
 */
export function expandReadingDocument(compact: CompactReadingDocument): BookReadingDocument {
  if (compact.v !== 1) {
    throw new Error(`Unsupported CompactReadingDocument version: ${String(compact.v)}`);
  }
  const out: BookReadingDocument = {
    bookId: compact.b,
    pdfPages: compact.p,
    ocrPending: compact.o === 1,
    chunks: compact.c.map(expandChunk),
  };
  if (compact.ev !== undefined) out.extractorVersion = compact.ev;
  if (compact.ai === 1) out.refinedByAi = true;
  return out;
}
