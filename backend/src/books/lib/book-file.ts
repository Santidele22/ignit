import { HttpException, HttpStatus } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import type { Repository } from 'typeorm';
import type { Book } from '../entities/book.entity.js';
import type { BookStorage } from '../storage/book-storage.js';
import { extractReadingFromPdf, writeBookReadingJson } from '../reading/book-reading.extractor.js';
import { assertSafePdfFile } from '../pdf-firewall/pdf-firewall.service.js';
import { emptyReadingDocument } from './book-reading.js';
import { readingJsonKey } from './book-sidecar-keys.js';

/** The multer temp file as the controller forwards it. */
export type UploadedPdf = {
  path: string;
  originalname: string;
  size: number;
  mimetype: string;
};

/**
 * Attaches (or replaces) the PDF of an existing book. The bytes are persisted
 * in storage *before* the row is touched, so a failed upload never leaves
 * `books.filePath` pointing at a missing object; the multer temp file is
 * dropped either way, and the replaced file is removed only after the new
 * reference is safely saved.
 */
export async function attachBookFile(
  booksRepository: Repository<Book>,
  bookStorage: BookStorage,
  book: Book,
  file: UploadedPdf,
): Promise<Book> {
  // The firewall runs before anything else: a rejected upload never reaches
  // text extraction nor durable storage, and `assertSafePdfFile` drops the
  // multer temp file itself (same convention as `assertStoredPdf`).
  await assertSafePdfFile(file.path);

  // Extract `reading.json` while `file.path` is still on local disk (in S3
  // mode `bookStorage.persist` deletes the multer temp file after upload).
  const readingDoc = await extractReadingFromPdf(book.id, file.path).catch(
    () => emptyReadingDocument(book.id),
  );

  const ref = await persistUploadedPdf(bookStorage, book.id, file);

  const previousRef = book.filePath;
  book.filePath = ref;
  book.originalName = file.originalname;
  book.fileSize = String(file.size);
  book.mimeType = file.mimetype;

  await saveAttachedBook(booksRepository, bookStorage, book, ref);

  if (previousRef && previousRef !== ref) {
    await bookStorage.remove(previousRef);
  }

  await writeBookReadingJson(book.id, readingDoc).catch(() => undefined);
  if (bookStorage.putJson) {
    await bookStorage
      .putJson(readingJsonKey(book.id), readingDoc)
      .catch(() => undefined);
  }

  return book;
}

/**
 * Persists the multer temp file and answers a clean 502 when the storage layer
 * rejects, dropping the temp copy first so no half-attached book survives.
 */
async function persistUploadedPdf(
  bookStorage: BookStorage,
  bookId: number,
  file: UploadedPdf,
): Promise<string> {
  try {
    return await bookStorage.persist(bookId, file);
  } catch (error) {
    // The uploaded copy never became durable storage: drop the temp file
    // and surface a clean error instead of a half-attached book.
    await unlink(file.path).catch(() => undefined);
    throw new HttpException(
      error instanceof Error && error.message
        ? `No se pudo almacenar el archivo: ${error.message}`
        : 'No se pudo almacenar el archivo',
      HttpStatus.BAD_GATEWAY,
    );
  }
}

/**
 * Saves the row pointing at the durable object; when the row does not take,
 * the just-uploaded object is removed so it never dangles unreferenced.
 */
async function saveAttachedBook(
  booksRepository: Repository<Book>,
  bookStorage: BookStorage,
  book: Book,
  ref: string,
): Promise<void> {
  try {
    await booksRepository.save(book);
  } catch (error) {
    await bookStorage.remove(ref);
    throw error;
  }
}
