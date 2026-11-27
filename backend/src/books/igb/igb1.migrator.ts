import type { Repository } from 'typeorm';
import type { Book } from '../entities/book.entity.js';
import { resolveReadingDocument } from '../lib/book-reading.js';
import { readingJsonKey } from '../lib/book-sidecar-keys.js';
import type { BookReadingDocument } from '../reading/reading.types.js';
import type { BookStorage } from '../storage/book-storage.js';
import { encodeIgb1 } from './igb1.codec.js';
import {
  computeContentHash,
  deriveBookKey,
  determineContentTier,
  persistBookIgb1,
  readBookIgb1,
} from './igb1.storage.js';

export interface MigrateIgb1Options {
  booksRepository: Repository<Book>;
  bookStorage: BookStorage;
  dryRun: boolean;
  purgeLegacy: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface MigrateIgb1Report {
  total: number;
  migrated: number;
  skipped: number;
  failed: number;
  legacyBytes: number;
  igbBytes: number;
  savedBytes: number;
  savedPct: number;
}

export async function migrateBooksToIgb1(
  options: MigrateIgb1Options,
): Promise<MigrateIgb1Report> {
  const { booksRepository, bookStorage, dryRun, purgeLegacy, env = process.env } = options;
  const books = await booksRepository.find();

  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  let legacyBytes = 0;
  let igbBytes = 0;

  for (const book of books) {
    try {
      const hasLegacyRef = Boolean(book.filePath);
      const alreadyHasIgb =
        Boolean(book.igbPath) &&
        typeof bookStorage.getBuffer === 'function' &&
        (await bookStorage.getBuffer(book.igbPath!)) !== null;

      if (alreadyHasIgb) {
        if (!dryRun && purgeLegacy && book.filePath && !book.filePath.endsWith('.igb')) {
          const oldRef = book.filePath;
          book.filePath = book.igbPath;
          await booksRepository.save(book);
          await bookStorage.remove(oldRef);
          await bookStorage.remove(readingJsonKey(book.id));
        }
        skipped++;
        continue;
      }

      let doc: BookReadingDocument | null = null;
      if (typeof bookStorage.getJson === 'function') {
        doc = await bookStorage.getJson<BookReadingDocument>(readingJsonKey(book.id));
      }
      if (!doc && hasLegacyRef) {
        doc = await resolveReadingDocument(book.id, book.filePath!, bookStorage);
      }
      if (!doc || doc.chunks.length === 0) {
        skipped++;
        continue;
      }

      const rawJsonBytes = Buffer.byteLength(JSON.stringify(doc), 'utf8');
      const declaredLegacyBytes = Number(book.fileSize ?? 0);
      legacyBytes += declaredLegacyBytes > 0 ? declaredLegacyBytes : rawJsonBytes;

      if (dryRun) {
        const tier = determineContentTier(book);
        const key = deriveBookKey(tier, book.id, book.ownerId, env);
        const simulated = encodeIgb1(doc, {
          bookId: String(book.id),
          tier,
          compression: tier === 'public_open' ? 'brotli' : 'gzip',
          key,
        });
        igbBytes += simulated.byteLength;
        migrated++;
        continue;
      }

      const persisted = await persistBookIgb1(bookStorage, book, doc, env);
      const verified = await readBookIgb1(
        bookStorage,
        {
          id: book.id,
          ownerId: book.ownerId,
          published: book.published,
          contentTier: persisted.contentTier,
          igbPath: persisted.igbPath,
          filePath: persisted.igbPath,
        },
        env,
      );
      if (!verified || verified.chunks.length !== doc.chunks.length) {
        throw new Error(`Verification failed after encoding book ${book.id}`);
      }

      const oldFilePath = book.filePath;
      book.contentTier = persisted.contentTier;
      book.contentHash = persisted.contentHash || computeContentHash(doc);
      book.igbPath = persisted.igbPath;
      book.igbSize = persisted.igbSize;
      book.filePath = persisted.igbPath;
      await booksRepository.save(book);

      if (purgeLegacy) {
        if (oldFilePath && !oldFilePath.endsWith('.igb')) {
          await bookStorage.remove(oldFilePath);
        }
        await bookStorage.remove(readingJsonKey(book.id));
      }

      igbBytes += persisted.igbSize;
      migrated++;
    } catch {
      failed++;
    }
  }

  const savedBytes = Math.max(0, legacyBytes - igbBytes);
  const savedPct = legacyBytes > 0 ? Math.round((savedBytes / legacyBytes) * 1000) / 10 : 0;

  return {
    total: books.length,
    migrated,
    skipped,
    failed,
    legacyBytes,
    igbBytes,
    savedBytes,
    savedPct,
  };
}
