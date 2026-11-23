import { BadRequestException } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import { hasPdfMagicBytes } from '../pdf.util.js';
import type { UploadedPdf } from '../lib/book-file.js';

/** Body-less uploads reach the handler as `undefined` (the mimetype filter rejected them). */
export const PDF_ONLY_MESSAGE = 'Solo se aceptan archivos PDF';

const INVALID_PDF_MESSAGE = 'El archivo subido no es un PDF válido';

/**
 * The mimetype filter of the upload interceptor trusts the client, so the
 * bytes written to disk are verified here and the temp file dropped when it is
 * not a real PDF.
 */
export async function assertStoredPdf(file: UploadedPdf): Promise<void> {
  if (await hasPdfMagicBytes(file.path)) {
    return;
  }
  await unlink(file.path).catch(() => undefined);
  throw new BadRequestException(INVALID_PDF_MESSAGE);
}

/** Guards the upload handler: `413`/`400` from multer aside, a rejected upload arrives as `undefined`. */
export function requireUploadedPdf(
  file: UploadedPdf | undefined,
): UploadedPdf {
  if (!file) {
    throw new BadRequestException(PDF_ONLY_MESSAGE);
  }
  return file;
}
