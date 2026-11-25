import { BadRequestException } from '@nestjs/common';
import { readFile, unlink } from 'node:fs/promises';
import JSZip from 'jszip';
import { detectBookFormat, EPUB_MIME_TYPE } from '../pdf.util.js';
import type { UploadedPdf } from '../lib/book-file.js';

/** Body-less uploads reach the handler as `undefined` (the mimetype filter rejected them). */
export const BOOK_ONLY_MESSAGE = 'Solo se aceptan archivos PDF o EPUB';

const INVALID_BOOK_FILE_MESSAGE = 'El archivo subido no es un PDF o EPUB válido';

/**
 * The mimetype filter of the upload interceptor trusts the client, so the bytes
 * written to disk are verified here and the temp file dropped when they are
 * neither a PDF nor a real EPUB (S6). A `PK` header alone is not enough: the
 * archive must also carry the OCF `mimetype` entry, so a plain ZIP (or a
 * polyglot prefixed with ZIP magic) never reaches the EPUB pipeline.
 */
export async function assertStoredBookFile(file: UploadedPdf): Promise<void> {
  const format = await detectBookFormat(file.path);
  if (format === 'pdf' || (format === 'epub' && (await hasEpubMimetypeEntry(file.path)))) {
    return;
  }
  await unlink(file.path).catch(() => undefined);
  throw new BadRequestException(INVALID_BOOK_FILE_MESSAGE);
}

/**
 * Historical name the upload controller still imports: it accepts PDF **and**
 * EPUB uploads now (S6), so new call sites should use `assertStoredBookFile`.
 */
export const assertStoredPdf = assertStoredBookFile;

/** Guards the upload handler: a rejected upload arrives as `undefined` (`413`/`400` kept by multer). */
export function requireUploadedPdf(
  file: UploadedPdf | undefined,
): UploadedPdf {
  if (!file) {
    throw new BadRequestException(BOOK_ONLY_MESSAGE);
  }
  return file;
}

/** Reads the `mimetype` entry the OCF container requires as its first file. */
async function hasEpubMimetypeEntry(filePath: string): Promise<boolean> {
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    return false;
  }
  try {
    const zip = await JSZip.loadAsync(bytes);
    const mimetype = zip.file('mimetype');
    if (!mimetype) return false;
    return (await mimetype.async('string')).replace(/\s+/g, '') === EPUB_MIME_TYPE;
  } catch {
    return false;
  }
}
