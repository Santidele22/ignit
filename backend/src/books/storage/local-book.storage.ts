import { createReadStream } from 'node:fs';
import { access, unlink } from 'node:fs/promises';
import { NotFoundException } from '@nestjs/common';
import type { BookStorage, BookDownload } from './book-storage.js';

/**
 * Development/test storage: multer's `diskStorage` already wrote the upload
 * under `BOOKS_UPLOAD_DIR`, so `persist` keeps the file where it is and the
 * stored reference stays the on-disk path, exactly like before the storage
 * abstraction existed.
 */
export class LocalBookStorage implements BookStorage {
  readonly strategy = 'local' as const;
  readonly uploadDir: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.uploadDir = env.BOOKS_UPLOAD_DIR ?? 'uploads/books';
  }

  async persist(
    _bookId: number,
    file: { path: string },
  ): Promise<string> {
    return file.path;
  }

  async remove(ref: string | null | undefined): Promise<void> {
    if (!ref) return;
    try {
      await unlink(ref);
    } catch {
      // Best effort: a missing file must not block the metadata update.
    }
  }

  async resolveDownload(ref: string): Promise<BookDownload> {
    try {
      await access(ref);
    } catch {
      throw new NotFoundException('El archivo solicitado no está disponible');
    }
    // The stream gets its error handler in the controller right after
    // resolution (before piping), so a file vanishing between this check
    // and the open cannot crash the process either.
    return { strategy: 'local', stream: createReadStream(ref) };
  }
}
