import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BookStorage } from '../storage/book-storage.js';
import {
  type BookReadingDocument,
  extractReadingFromPdf,
  writeBookReadingJson,
} from '../reading/book-reading.extractor.js';
import { readCachedReading } from './book-reading-cache.js';
import { readingJsonKey } from './book-sidecar-keys.js';

/** Placeholder doc used whenever extraction cannot produce chunks yet. */
export function emptyReadingDocument(bookId: number): BookReadingDocument {
  return {
    bookId: String(bookId),
    pdfPages: 1,
    ocrPending: true,
    chunks: [],
  };
}

/**
 * Serves the derived `reading.json` contract (`07-del-horno-al-visor`) for a
 * published book. Serves the cached sidecars when they are current, otherwise
 * extracts lazily from the stored PDF and persists the result.
 */
export async function resolveReadingDocument(
  bookId: number,
  filePath: string,
  bookStorage: BookStorage,
): Promise<BookReadingDocument> {
  const { current, fallback } = await readCachedReading(bookId, bookStorage);
  if (current) {
    return current;
  }

  let extracted = await extractReadingDocument(bookId, filePath, bookStorage, fallback);
  if (extracted.ocrPending && fallback) {
    extracted = fallback;
  }

  await writeBookReadingJson(bookId, extracted).catch(() => undefined);
  if (bookStorage.putJson && !extracted.ocrPending) {
    await bookStorage.putJson(readingJsonKey(bookId), extracted).catch(() => undefined);
  }

  return extracted;
}

/**
 * Extracts the document from wherever the bytes live: straight from the stored
 * reference for `local`, or by fetching the presigned URL (S3) into a temp
 * file when the storage layer still has the object.
 */
async function extractReadingDocument(
  bookId: number,
  filePath: string,
  bookStorage: BookStorage,
  fallbackCached: BookReadingDocument | null,
): Promise<BookReadingDocument> {
  if (bookStorage.strategy !== 's3') {
    const extracted = await extractReadingFromPdf(bookId, filePath).catch(
      () => fallbackCached ?? emptyReadingDocument(bookId),
    );
    if (extracted.ocrPending && fallbackCached) {
      return fallbackCached;
    }
    return extracted;
  }

  const delivery = await bookStorage.resolveDownload(filePath);
  if (delivery.strategy !== 's3') {
    return extractReadingFromPdf(bookId, filePath);
  }

  return extractFromPresignedUrl(bookId, delivery.url, fallbackCached);
}

/**
 * Downloads the stored PDF into a temp file, extracts it while it exists, and
 * always removes the temp copy. Any transport failure falls back to the cached
 * doc (or the pending-OCR placeholder) instead of failing the request.
 */
async function extractFromPresignedUrl(
  bookId: number,
  url: string,
  fallbackCached: BookReadingDocument | null,
): Promise<BookReadingDocument> {
  const tempPdf = join(tmpdir(), `book-${bookId}-${Date.now()}.pdf`);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return fallbackCached ?? emptyReadingDocument(bookId);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(tempPdf, buf);
    return await extractReadingFromPdf(bookId, tempPdf);
  } catch {
    return fallbackCached ?? emptyReadingDocument(bookId);
  } finally {
    await unlink(tempPdf).catch(() => undefined);
  }
}
