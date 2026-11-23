import type { BookStorage } from '../storage/book-storage.js';
import {
  type BookReadingDocument,
  READING_EXTRACTOR_VERSION,
  readBookReadingJson,
  writeBookReadingJson,
} from '../reading/book-reading.extractor.js';
import { readingJsonKey } from './book-sidecar-keys.js';

/** The two cached candidates: one servable as-is, one only as a fallback. */
export type CachedReading = {
  current: BookReadingDocument | null;
  fallback: BookReadingDocument | null;
};

/** A doc with chunks (or no pending OCR) is usable even if an older extractor built it. */
function hasReadingContent(doc: BookReadingDocument): boolean {
  return !doc.ocrPending || doc.chunks.length > 0;
}

function isCurrentReadingDocument(doc: BookReadingDocument | null | undefined): boolean {
  return Boolean(
    doc &&
      (!doc.ocrPending || doc.chunks.length > 0) &&
      (doc.extractorVersion ?? 1) >= READING_EXTRACTOR_VERSION,
  );
}

/**
 * Looks the derived document up on local disk first and then in the S3
 * sidecar. An S3 hit that is current is warmed back to local disk. The
 * returned `current` is only set when the doc can be served directly; the
 * `fallback` keeps the best usable-but-stale candidate for a failed extraction.
 */
export async function readCachedReading(
  bookId: number,
  bookStorage: BookStorage,
): Promise<CachedReading> {
  const cached = await readBookReadingJson(bookId);
  const fallback: BookReadingDocument | null =
    cached && hasReadingContent(cached) ? cached : null;

  if (cached && isCurrentReadingDocument(cached)) {
    return { current: cached, fallback };
  }

  if (bookStorage.getJson) {
    const s3Cached = await bookStorage.getJson<BookReadingDocument>(readingJsonKey(bookId));
    if (s3Cached && isCurrentReadingDocument(s3Cached)) {
      await writeBookReadingJson(bookId, s3Cached).catch(() => undefined);
      return { current: s3Cached, fallback };
    }
    if (!fallback && s3Cached && hasReadingContent(s3Cached)) {
      return { current: null, fallback: s3Cached };
    }
  }

  return { current: null, fallback };
}
