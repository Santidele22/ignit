import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import type { Repository } from 'typeorm';
import { aiColumnsFor, analyzeReadingDocument } from '../ai/ai-analysis.service.js';
import { refineReadingDocument } from '../ai/ai-refiner.service.js';
import type { Book } from '../entities/book.entity.js';
import type { BookStorage } from '../storage/book-storage.js';
import {
  extractReadingFromPdf,
  writeBookReadingJson,
} from '../reading/book-reading.extractor.js';
import { writeBookDeterministicReadingJson } from '../reading/reading.state.js';
import {
  inspectSafePdfFile,
} from '../pdf-firewall/pdf-firewall.service.js';
import type { PdfFirewallReport } from '../pdf-firewall/pdf-firewall.types.js';
import { saveBookFirewallReport } from './book-firewall-report.js';
import { emptyReadingDocument } from './book-reading.js';
import { readingDeterministicJsonKey, readingJsonKey } from './book-sidecar-keys.js';

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
  // text extraction nor durable storage, and `inspectSafePdfFile` drops the
  // multer temp file itself (same convention as `assertStoredPdf`). The full
  // per-tier report is captured for /admin and written in both outcomes (S2).
  let firewallReport: PdfFirewallReport | null = null;
  const verdict = await inspectSafePdfFile(file.path, (report) => {
    firewallReport = report;
  }).catch(async (error: unknown) => {
    if (firewallReport) {
      // Persisted before rethrowing so the 400 response and the report land
      // together; a failed sidecar write never masks the original rejection.
      await saveBookFirewallReport(book.id, firewallReport, bookStorage).catch(() => undefined);
    }
    throw error;
  });

  const fileHash = await hashFileSha256(file.path);
  await assertNoDuplicateUpload(booksRepository, book, file, fileHash);

  // Extract `reading.json` while `file.path` is still on local disk (in S3
  // mode `bookStorage.persist` deletes the multer temp file after upload).
  const deterministicDoc = await extractReadingFromPdf(book.id, file.path).catch(
    () => emptyReadingDocument(book.id),
  );

  // Optional LLM structural refiner: keeps the deterministic extraction as the
  // base and applies chunk-ID patches (`toc`, headings, cross-page merges)
  // fail-open so Vigilia's unified book aesthetic renders cleanly.
  const refined = await refineReadingDocument(deterministicDoc);
  const readingDoc = refined.document;

  // Optional AI text analysis (S3), after the firewall and the extraction, and
  // strictly fail-open: `analyzeReadingDocument` answers `null` on any problem
  // (env gate off, timeout, refusal, unparseable answer) and the upload keeps
  // going with `aiStatus: 'skipped'`.
  const aiColumns = aiColumnsFor(await analyzeReadingDocument(readingDoc));

  const ref = await persistUploadedPdf(bookStorage, book.id, file);

  const previousRef = book.filePath;
  book.filePath = ref;
  book.originalName = file.originalname;
  book.fileSize = String(file.size);
  book.fileHash = fileHash;
  book.filePages = verdict.pageCount;
  book.mimeType = file.mimetype;
  Object.assign(book, aiColumns);

  await saveAttachedBook(booksRepository, bookStorage, book, ref);

  if (previousRef && previousRef !== ref) {
    await bookStorage.remove(previousRef);
  }

  if (refined.summary.applied) {
    await writeBookDeterministicReadingJson(book.id, deterministicDoc).catch(() => undefined);
    if (bookStorage.putJson) {
      await bookStorage
        .putJson(readingDeterministicJsonKey(book.id), deterministicDoc)
        .catch(() => undefined);
    }
  }

  await writeBookReadingJson(book.id, readingDoc).catch(() => undefined);
  if (bookStorage.putJson) {
    await bookStorage
      .putJson(readingJsonKey(book.id), readingDoc)
      .catch(() => undefined);
  }

  if (firewallReport) {
    await saveBookFirewallReport(book.id, firewallReport, bookStorage).catch(() => undefined);
  }

  return book;
}

async function hashFileSha256(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

async function assertNoDuplicateUpload(
  booksRepository: Repository<Book>,
  book: Book,
  file: UploadedPdf,
  fileHash: string,
): Promise<void> {
  if (typeof booksRepository.find !== 'function') {
    return;
  }

  const existing = await booksRepository.find({ where: { ownerId: book.ownerId } });
  if (!Array.isArray(existing)) {
    return;
  }
  const incomingName = file.originalname.trim().toLowerCase();

  for (const row of existing) {
    if (row.id === book.id) continue;
    if (row.fileHash && row.fileHash === fileHash) {
      await unlink(file.path).catch(() => undefined);
      throw new ConflictException('Este PDF ya fue subido anteriormente (archivo duplicado).');
    }
    if (incomingName && row.originalName && row.originalName.trim().toLowerCase() === incomingName) {
      await unlink(file.path).catch(() => undefined);
      throw new ConflictException(
        'Ya subiste otro PDF con el mismo nombre de archivo. Renombralo o editá el libro existente.',
      );
    }
  }
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
