import { diskStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { EPUB_MIME_TYPE } from '../pdf.util.js';

/**
 * Multer storage and limits for `POST /books/:id/file`. The multipart file is
 * written to disk under `BOOKS_UPLOAD_DIR` (default `uploads/books`) with a
 * generated name: the original one is client-controlled, so the stored file
 * always gets the extension of the accepted type (`.pdf`, or `.epub` for the
 * EPUB mime type; S6). Both are only hints — the handler verifies the bytes on
 * disk and the ingestion pipeline dispatches on the detected format.
 */
export const booksUploadDir = process.env.BOOKS_UPLOAD_DIR ?? 'uploads/books';

const defaultMaxFileSize = 50 * 1024 * 1024;

/**
 * `BOOKS_MAX_FILE_SIZE` must be a positive byte count; anything else
 * (missing, `NaN`, zero, negative) silently falls back to the default so a
 * typo cannot disable the upload limit.
 */
export function resolveMaxFileSize(raw: string | undefined): number {
  if (raw === undefined) {
    return defaultMaxFileSize;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMaxFileSize;
}

export const booksMaxFileSize = resolveMaxFileSize(process.env.BOOKS_MAX_FILE_SIZE);

const PDF_MIMETYPE = 'application/pdf';

/** Both accepted book formats (S6); anything else never reaches the handler. */
export const BOOK_UPLOAD_MIMETYPES: readonly string[] = [PDF_MIMETYPE, EPUB_MIME_TYPE];

export const booksPdfStorage = diskStorage({
  destination: (_req, _file, cb) => {
    mkdirSync(booksUploadDir, { recursive: true });
    cb(null, booksUploadDir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const extension = file.mimetype === EPUB_MIME_TYPE ? '.epub' : '.pdf';
    cb(null, `${unique}${extension}`);
  },
});

/**
 * Options of the `FileInterceptor` guarding the upload: only `application/pdf`
 * and `application/epub+zip` reach the handler, capped at `BOOKS_MAX_FILE_SIZE`.
 * The mimetype is client-controlled, so the handler still verifies the bytes on
 * disk (`assertStoredBookFile`) and the pipeline dispatches on content.
 */
export const booksPdfInterceptorOptions: MulterOptions = {
  storage: booksPdfStorage,
  fileFilter: (_req, file, cb) => {
    if (!BOOK_UPLOAD_MIMETYPES.includes(file.mimetype)) {
      cb(null, false);
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: booksMaxFileSize },
};
