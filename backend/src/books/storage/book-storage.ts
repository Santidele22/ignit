import type { Readable } from 'node:stream';
import { LocalBookStorage } from './local-book.storage.js';
import { S3BookStorage } from './s3-book.storage.js';

/**
 * Where the bytes of an uploaded PDF live. `local` keeps the historical
 * behaviour (multer wrote the file under `BOOKS_UPLOAD_DIR` and
 * `books.filePath` holds that path); `s3` stores the object key in
 * `books.filePath` and the bytes in the private Neon Object Storage bucket.
 */
export interface BookStorage {
  readonly strategy: 'local' | 's3';

  /**
   * Persists the multer temp file and returns the reference written to
   * `books.filePath`. Resolves only after the bytes are durably stored
   * (upload finished for `s3`), so a row is never saved pointing at a
   * missing object; on rejection the temp file may still exist and the
   * caller cleans it.
   */
  persist(
    bookId: number,
    file: { path: string; size: number; mimetype: string },
  ): Promise<string>;

  /** Best-effort removal of the file a stored reference points at. */
  remove(ref: string | null | undefined): Promise<void>;

  /**
   * Resolves how the file behind a stored reference is delivered. `local`
   * streams it (the caller pipes it to the response); `s3` answers a
   * short-lived presigned URL the caller redirects to. A missing object is
   * a `NotFoundException`, never an unhandled stream error.
   */
  resolveDownload(ref: string): Promise<BookDownload>;

  /**
   * Optional JSON sidecar storage (`reading/<id>/reading.json` and
   * `reading/<id>/state.json`) so derived reading chunks and reading progress
   * survive ephemeral container restarts when `strategy === 's3'`.
   */
  getJson?<T>(key: string): Promise<T | null>;
  putJson?(key: string, data: unknown): Promise<void>;

  /** Binary buffer storage for compact `.igb` book blobs. */
  getBuffer?(key: string): Promise<Buffer | null>;
  putBuffer?(
    key: string,
    data: Buffer,
    options?: { contentType?: string; cacheControl?: string },
  ): Promise<void>;
  /** Short-lived presigned upload URL for client-side Tier 2 `.igb` sync. */
  resolveUpload?(key: string, contentType?: string): Promise<string | null>;
}

export type BookDownload =
  | { strategy: 'local'; stream: Readable }
  | { strategy: 's3'; url: string };

/** DI token for the `BookStorage` implementation the module registered. */
export const BOOK_STORAGE: unique symbol = Symbol('BOOK_STORAGE');

/**
 * Picks the storage strategy from `BOOKS_STORAGE` (`local` by default).
 * `s3` requires the AWS-standard Neon Object Storage variables and fails
 * closed at boot when any is missing, instead of surfacing a broken client
 * on the first upload.
 */
export function createBookStorage(env: NodeJS.ProcessEnv = process.env): BookStorage {
  if ((env.BOOKS_STORAGE ?? 'local') === 's3') {
    return new S3BookStorage(env);
  }
  return new LocalBookStorage(env);
}
