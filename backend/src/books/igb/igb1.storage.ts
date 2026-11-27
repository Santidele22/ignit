import { createHash, hkdfSync } from 'node:crypto';
import type { Book } from '../entities/book.entity.js';
import type { BookReadingDocument } from '../reading/reading.types.js';
import type { BookStorage } from '../storage/book-storage.js';
import { decodeIgb1, encodeIgb1 } from './igb1.codec.js';
import { compactReadingDocument } from './igb1.compactor.js';
import { IGB1_KEY_BYTES, type ContentTier } from './igb1.types.js';

const DEFAULT_DEV_MASTER_KEY = 'ignit-dev-igb-master-key-32-bytes!';
export const IGB1_MIME_TYPE = 'application/vnd.ignit.igb1';

export function determineContentTier(book: Pick<Book, 'published' | 'contentTier'>): ContentTier {
  if (book.contentTier === 'editorial_closed') return 'editorial_closed';
  return book.published === true ? 'public_open' : 'private_user';
}

export function computeContentHash(doc: BookReadingDocument): string {
  const compact = compactReadingDocument(doc);
  // Exclude per-row bookId so identical public books deduplicate globally.
  const canonical = JSON.stringify({ ...compact, b: '' });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function igbObjectKey(
  tier: ContentTier,
  params: { bookId: number; ownerId: string; contentHash: string },
): string {
  if (tier === 'public_open') {
    return `books/public/${params.contentHash}.igb`;
  }
  if (tier === 'editorial_closed') {
    return `books/editorial/${params.bookId}.igb`;
  }
  return `books/private/${params.ownerId}/${params.bookId}.igb`;
}

export function deriveBookKey(
  tier: ContentTier,
  bookId: number | string,
  ownerId: string,
  env: NodeJS.ProcessEnv = process.env,
): Buffer | undefined {
  if (tier === 'public_open') return undefined;
  const master = env.IGB_MASTER_KEY ?? env.BETTER_AUTH_SECRET ?? DEFAULT_DEV_MASTER_KEY;
  const raw = hkdfSync(
    'sha256',
    Buffer.from(master, 'utf8'),
    Buffer.from(`ignit:${tier}:${ownerId}`, 'utf8'),
    Buffer.from(`book:${bookId}`, 'utf8'),
    IGB1_KEY_BYTES,
  );
  return Buffer.from(raw);
}

export interface PersistedIgbResult {
  contentTier: ContentTier;
  contentHash: string;
  igbPath: string;
  igbSize: number;
}

export async function persistBookIgb1(
  bookStorage: BookStorage,
  book: Pick<Book, 'id' | 'ownerId' | 'published' | 'contentTier'>,
  readingDoc: BookReadingDocument,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PersistedIgbResult> {
  if (typeof bookStorage.putBuffer !== 'function') {
    throw new Error('BookStorage does not implement putBuffer');
  }

  const contentTier = determineContentTier(book);
  const contentHash = computeContentHash(readingDoc);
  const igbPath = igbObjectKey(contentTier, {
    bookId: book.id,
    ownerId: book.ownerId,
    contentHash,
  });

  const key = deriveBookKey(contentTier, book.id, book.ownerId, env);
  const igbBuf = encodeIgb1(readingDoc, {
    bookId: String(book.id),
    tier: contentTier,
    compression: contentTier === 'public_open' ? 'brotli' : 'gzip',
    key,
  });

  await bookStorage.putBuffer(igbPath, igbBuf, {
    contentType: IGB1_MIME_TYPE,
    cacheControl:
      contentTier === 'public_open'
        ? 'public, max-age=31536000, immutable'
        : 'private, no-store',
  });

  return {
    contentTier,
    contentHash,
    igbPath,
    igbSize: igbBuf.byteLength,
  };
}

export async function readBookIgb1(
  bookStorage: BookStorage,
  book: Pick<Book, 'id' | 'ownerId' | 'published' | 'contentTier' | 'igbPath' | 'filePath'>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BookReadingDocument | null> {
  if (typeof bookStorage.getBuffer !== 'function') return null;
  const keyPath = book.igbPath ?? (book.filePath?.endsWith('.igb') ? book.filePath : null);
  if (!keyPath) return null;

  const buf = await bookStorage.getBuffer(keyPath);
  if (!buf) return null;

  const tier = determineContentTier(book);
  const key = deriveBookKey(tier, book.id, book.ownerId, env);
  const decoded = decodeIgb1(buf, {
    bookId: String(book.id),
    tier,
    key,
  });
  if (tier === 'public_open') {
    decoded.bookId = String(book.id);
  }
  return decoded;
}
