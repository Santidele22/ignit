import { BadRequestException, ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import type { Repository } from 'typeorm';
import { aiColumnsFor, analyzeReadingDocument } from '../ai/ai-analysis.service.js';
import { refineReadingDocument } from '../ai/ai-refiner.service.js';
import type { Book } from '../entities/book.entity.js';
import type { BookStorage } from '../storage/book-storage.js';
import {
  assessReadingLegibility,
  extractReadingFromPdf,
  ILLEGIBLE_READING_MESSAGE,
  writeBookReadingJson,
} from '../reading/book-reading.extractor.js';
import {
  extractReadingFromEpub,
  type EpubMetadata,
  type EpubReadingExtraction,
} from '../reading/reading.epub.js';
import { writeBookDeterministicReadingJson } from '../reading/reading.state.js';
import { inspectEpubBufferWithPipeline } from '../pdf-firewall/epub-firewall.service.js';
import type {
  EpubFirewallReport,
  EpubViolation,
} from '../pdf-firewall/epub-firewall.types.js';
import { inspectSafePdfFile } from '../pdf-firewall/pdf-firewall.service.js';
import type { PdfFirewallReport } from '../pdf-firewall/pdf-firewall.types.js';
import { detectBookFormat, EPUB_MIME_TYPE } from '../pdf.util.js';
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

/** Message shared by both formats when the temp file vanished before validation. */
const UNREADABLE_FILE_MESSAGE = 'El archivo subido no se pudo leer para validarlo';

/**
 * Attaches (or replaces) the PDF **or EPUB** of an existing book (S6). The
 * format is sniffed from the stored bytes — never from the client-claimed mime
 * type — and dispatched to its own firewall and extractor; every other step
 * (hashing, duplicate check, legibility gate, AI stage, persistence) is shared,
 * so the PDF path keeps behaving exactly as before. The bytes are persisted in
 * storage *before* the row is touched, so a failed upload never leaves
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
  const isEpub = (await detectBookFormat(file.path)) === 'epub';

  // The firewall runs before anything else: a rejected upload never reaches
  // text extraction nor durable storage, and both inspectors drop the multer
  // temp file themselves (same convention as `assertStoredBookFile`). The full
  // per-tier report is captured for /admin and written in both outcomes (S2).
  let firewallReport: PdfFirewallReport | null = null;
  const captureReport = (report: PdfFirewallReport | EpubFirewallReport): void => {
    // Structural widening: /admin consumes `schemaVersion` + `tiers[].{status,
    // checks}` from the same sidecar slot, and the EPUB report carries exactly
    // that shape; only its tier names and violation codes differ.
    firewallReport = report as unknown as PdfFirewallReport;
  };

  let pdfPageCount = 0;
  try {
    if (isEpub) {
      await inspectEpubUpload(file.path, captureReport);
    } else {
      pdfPageCount = (await inspectSafePdfFile(file.path, captureReport)).pageCount;
    }
  } catch (error) {
    if (firewallReport) {
      // Persisted before rethrowing so the 400 response and the report land
      // together; a failed sidecar write never masks the original rejection.
      await saveBookFirewallReport(book.id, firewallReport, bookStorage).catch(() => undefined);
    }
    throw error;
  }

  const fileHash = await hashFileSha256(file.path);
  await assertNoDuplicateUpload(booksRepository, book, file, fileHash);

  // Extract `reading.json` while `file.path` is still on local disk (in S3
  // mode `bookStorage.persist` deletes the multer temp file after upload).
  // The EPUB extractor already reports illegible text as a `400`; the shared
  // gate below still runs for both formats per S1.
  const epub = isEpub ? await extractEpubDocument(book.id, file.path) : null;
  const deterministicDoc =
    epub?.document ??
    (await extractReadingFromPdf(book.id, file.path).catch(() => emptyReadingDocument(book.id)));

  const legibility = assessReadingLegibility(deterministicDoc);
  if (!legibility.legible) {
    await unlink(file.path).catch(() => undefined);
    throw new BadRequestException(legibility.reason ?? ILLEGIBLE_READING_MESSAGE);
  }

  const runAiSync = process.env.NODE_ENV === 'test';
  let readingDoc = deterministicDoc;
  let refinedApplied = false;
  let aiColumns = aiColumnsFor(null);

  if (runAiSync) {
    const refined = await refineReadingDocument(deterministicDoc);
    readingDoc = refined.document;
    refinedApplied = refined.summary.applied;
    aiColumns = aiColumnsFor(await analyzeReadingDocument(readingDoc));
  }

  // Canonical mime type per format (the client-claimed one is only trusted for
  // PDFs, where the upload filter already pinned it) and the page basis the
  // reader needs: the firewall count for PDFs, the synthetic pagination the
  // EPUB extractor produced for EPUBs.
  const mimeType = isEpub ? EPUB_MIME_TYPE : file.mimetype;
  const filePages = isEpub ? deterministicDoc.pdfPages : pdfPageCount;

  const ref = await persistUploadedPdf(bookStorage, book.id, { ...file, mimetype: mimeType });

  const previousRef = book.filePath;
  book.filePath = ref;
  book.originalName = file.originalname;
  book.fileSize = String(file.size);
  book.fileHash = fileHash;
  book.filePages = filePages;
  book.mimeType = mimeType;
  Object.assign(book, aiColumns);
  if (epub?.metadata) {
    prefillBookMetadata(book, epub.metadata);
  }

  await saveAttachedBook(booksRepository, bookStorage, book, ref);

  if (previousRef && previousRef !== ref) {
    await bookStorage.remove(previousRef);
  }

  if (refinedApplied) {
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

  if (!runAiSync) {
    void runPostUploadAiPipeline(booksRepository, bookStorage, book, deterministicDoc);
  }

  return book;
}

async function runPostUploadAiPipeline(
  booksRepository: Repository<Book>,
  bookStorage: BookStorage,
  book: Book,
  deterministicDoc: Awaited<ReturnType<typeof extractReadingFromPdf>>,
): Promise<void> {
  try {
    const refined = await refineReadingDocument(deterministicDoc);
    const readingDoc = refined.document;

    if (refined.summary.applied || (refined.summary.clutter?.length ?? 0) > 0) {
      await writeBookDeterministicReadingJson(book.id, deterministicDoc).catch(() => undefined);
      await writeBookReadingJson(book.id, readingDoc).catch(() => undefined);
      if (bookStorage.putJson) {
        await bookStorage
          .putJson(readingDeterministicJsonKey(book.id), deterministicDoc)
          .catch(() => undefined);
        await bookStorage.putJson(readingJsonKey(book.id), readingDoc).catch(() => undefined);
      }
    }

    const aiColumns = aiColumnsFor(await analyzeReadingDocument(readingDoc));
    Object.assign(book, aiColumns);
    await booksRepository.save(book);
  } catch {
    // Fail-open: background AI pipeline never crashes the server.
  }
}

/**
 * Reads the EPUB once, hands the bytes to the S5 extractor and answers the
 * `400` on illegible text (`reading.epub.ts` throws the legibility message).
 */
async function extractEpubDocument(
  bookId: number,
  filePath: string,
): Promise<EpubReadingExtraction> {
  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch {
    await unlink(filePath).catch(() => undefined);
    throw new BadRequestException(UNREADABLE_FILE_MESSAGE);
  }
  try {
    return await extractReadingFromEpub(bookId, buffer);
  } catch (error) {
    await unlink(filePath).catch(() => undefined);
    throw new BadRequestException(
      error instanceof Error && error.message ? error.message : ILLEGIBLE_READING_MESSAGE,
    );
  }
}

/**
 * EPUB firewall over the stored bytes (same contract as `inspectSafePdfFile`):
 * the temp file is dropped on rejection, the per-tier report is captured for
 * both outcomes and a `400` answers every violation deterministically.
 */
async function inspectEpubUpload(
  filePath: string,
  onReport: (report: EpubFirewallReport) => void,
): Promise<void> {
  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch {
    await unlink(filePath).catch(() => undefined);
    throw new BadRequestException(UNREADABLE_FILE_MESSAGE);
  }

  let report: EpubFirewallReport;
  try {
    report = await inspectEpubBufferWithPipeline(buffer);
  } catch (error) {
    await unlink(filePath).catch(() => undefined);
    const detail = error instanceof Error && error.message ? error.message : undefined;
    throw new BadRequestException(epubRejectionMessage([{ code: 'MISSING_EPUB_ZIP', detail }]));
  }

  onReport(report);
  if (report.safe) {
    return;
  }

  await unlink(filePath).catch(() => undefined);
  throw new BadRequestException(epubRejectionMessage(report.violations));
}

/** Spanish `400` naming every EPUB firewall violation (mirrors the PDF one). */
export function epubRejectionMessage(violations: readonly EpubViolation[]): string {
  const reasons = violations.map((violation) =>
    violation.detail ? `${violation.code} ${violation.detail}` : violation.code,
  );
  return (
    `El EPUB fue rechazado por el filtro de seguridad: ${reasons.join(', ')}. ` +
    'Eliminá el contenido activo y volvé a subirlo.'
  );
}

/**
 * Prefills the OPF metadata (S5) only into columns that are still empty: an
 * admin-entered — or filename-derived — value is never overwritten.
 */
function prefillBookMetadata(book: Book, metadata: EpubMetadata): void {
  if (isUnset(book.title) && metadata.title) book.title = metadata.title;
  if (isUnset(book.author) && metadata.author) book.author = metadata.author;
  if (isUnset(book.description) && metadata.description) book.description = metadata.description;
  if (isUnset(book.publisher) && metadata.publisher) book.publisher = metadata.publisher;
  if (isUnset(book.isbn) && metadata.isbn) book.isbn = metadata.isbn;
}

function isUnset(value: string | null | undefined): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
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
      throw new ConflictException('Este archivo ya fue subido anteriormente (archivo duplicado).');
    }
    if (incomingName && row.originalName && row.originalName.trim().toLowerCase() === incomingName) {
      await unlink(file.path).catch(() => undefined);
      throw new ConflictException(
        'Ya subiste otro archivo con este nombre. Renombralo o editá el libro existente.',
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
