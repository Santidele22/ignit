import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BookStorage } from '../storage/book-storage.js';
import {
  type BookReadingDocument,
  extractReadingFromPdf,
  writeBookReadingJson,
} from '../reading/book-reading.extractor.js';
import { extractReadingFromEpub } from '../reading/reading.epub.js';
import { detectBookFormat, detectBookFormatFromHeader } from '../pdf.util.js';
import { readCachedReading } from './book-reading-cache.js';
import { readingJsonKey } from './book-sidecar-keys.js';
import type { Book } from '../entities/book.entity.js';
import { readBookIgb1 } from '../igb/igb1.storage.js';

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
 * extracts lazily from the stored PDF **or EPUB** (S6) and persists the result.
 */
export async function resolveReadingDocument(
  bookId: number,
  filePath: string,
  bookStorage: BookStorage,
  book?: Pick<Book, 'id' | 'ownerId' | 'published' | 'contentTier' | 'igbPath' | 'filePath'>,
): Promise<BookReadingDocument> {
  if (book) {
    const fromIgb = await readBookIgb1(bookStorage, book).catch(() => null);
    if (fromIgb) {
      return fromIgb;
    }
  }

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
 * file when the storage layer still has the object. The format is sniffed from
 * the stored bytes; EPUBs go to the S5 extractor directly from memory.
 */
async function extractReadingDocument(
  bookId: number,
  filePath: string,
  bookStorage: BookStorage,
  fallbackCached: BookReadingDocument | null,
): Promise<BookReadingDocument> {
  if (bookStorage.strategy !== 's3') {
    const extracted = await extractStoredReading(bookId, filePath).catch(
      () => fallbackCached ?? emptyReadingDocument(bookId),
    );
    if (extracted.ocrPending && fallbackCached) {
      return fallbackCached;
    }
    return extracted;
  }

  const delivery = await bookStorage.resolveDownload(filePath);
  if (delivery.strategy !== 's3') {
    return extractStoredReading(bookId, filePath);
  }

  return extractFromPresignedUrl(bookId, delivery.url, fallbackCached);
}

/** Dispatches one on-disk file to the extractor of its actual format. */
async function extractStoredReading(
  bookId: number,
  filePath: string,
): Promise<BookReadingDocument> {
  if ((await detectBookFormat(filePath)) === 'epub') {
    return (await extractReadingFromEpub(bookId, await readFile(filePath))).document;
  }
  return extractReadingFromPdf(bookId, filePath);
}

/**
 * Downloads the stored file, extracts it, and always removes the temp copy an
 * EPUB never needs (the extractor reads the ZIP from the buffer); a PDF keeps
 * the historical `.pdf` temp name. Any transport failure falls back to the
 * cached doc (or the pending-OCR placeholder) instead of failing the request.
 */
async function extractFromPresignedUrl(
  bookId: number,
  url: string,
  fallbackCached: BookReadingDocument | null,
): Promise<BookReadingDocument> {
  const tempFile = join(tmpdir(), `book-${bookId}-${Date.now()}.pdf`);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return fallbackCached ?? emptyReadingDocument(bookId);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (detectBookFormatFromHeader(buf) === 'epub') {
      return (await extractReadingFromEpub(bookId, buf)).document;
    }
    await writeFile(tempFile, buf);
    return await extractReadingFromPdf(bookId, tempFile);
  } catch {
    return fallbackCached ?? emptyReadingDocument(bookId);
  } finally {
    await unlink(tempFile).catch(() => undefined);
  }
}
