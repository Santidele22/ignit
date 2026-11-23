import { diskStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/**
 * Multer storage and limits for `POST /books/:id/file`. The multipart file is
 * written to disk under `BOOKS_UPLOAD_DIR` (default `uploads/books`) with a
 * generated name: the original one is client-controlled, so the stored file
 * always gets the `.pdf` extension the magic-byte check guarantees.
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

export const booksPdfStorage = diskStorage({
  destination: (_req, _file, cb) => {
    mkdirSync(booksUploadDir, { recursive: true });
    cb(null, booksUploadDir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}.pdf`);
  },
});

/**
 * Options of the `FileInterceptor` guarding the upload: only
 * `application/pdf` reaches the handler, capped at `BOOKS_MAX_FILE_SIZE`. The
 * mimetype is client-controlled, so the handler still verifies the bytes on
 * disk (`assertStoredPdf`).
 */
export const booksPdfInterceptorOptions: MulterOptions = {
  storage: booksPdfStorage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== PDF_MIMETYPE) {
      cb(null, false);
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: booksMaxFileSize },
};
