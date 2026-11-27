import { describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import type { Book } from '../entities/book.entity.js';
import type { BookReadingDocument } from '../reading/reading.types.js';
import type { BookStorage } from '../storage/book-storage.js';
import { migrateBooksToIgb1 } from './igb1.migrator.js';
import { readingJsonKey } from '../lib/book-sidecar-keys.js';

function makeDoc(bookId: string): BookReadingDocument {
  return {
    bookId,
    pdfPages: 10,
    ocrPending: false,
    extractorVersion: 3,
    chunks: Array.from({ length: 40 }, (_, i) => ({
      id: `c-${i}`,
      type: 'para' as const,
      page: 1,
      offset: i * 100,
      text: `Contenido de ejemplo número ${i} para probar la migración de libros existentes a formato compacto IGB1.`,
      mood: 'espera' as const,
      cues: [],
      align: 'left' as const,
    })),
  };
}

describe('migrateBooksToIgb1 (S3)', () => {
  it('dry-run estimates savings without writing .igb, saving DB rows, or deleting legacy files', async () => {
    const legacyDoc = makeDoc('1');
    const buffers = new Map<string, Buffer>();
    const jsons = new Map<string, unknown>([[readingJsonKey(1), legacyDoc]]);
    const remove = vi.fn(async () => undefined);
    const save = vi.fn(async (b: Book) => b);

    const bookStorage: BookStorage = {
      strategy: 's3',
      persist: vi.fn(),
      remove,
      resolveDownload: vi.fn(),
      getJson: vi.fn(async <T>(k: string) => (jsons.get(k) as T) ?? null),
      putBuffer: vi.fn(async (k, data) => {
        buffers.set(k, data);
      }),
      getBuffer: vi.fn(async (k) => buffers.get(k) ?? null),
    };

    const books = [
      {
        id: 1,
        ownerId: 'u1',
        published: true,
        contentTier: 'public_open',
        filePath: 'legacy-1.pdf',
        fileSize: '500000',
        igbPath: null,
      } as Book,
    ];
    const booksRepository = {
      find: vi.fn(async () => books),
      save,
    } as unknown as Repository<Book>;

    const report = await migrateBooksToIgb1({
      booksRepository,
      bookStorage,
      dryRun: true,
      purgeLegacy: true,
    });

    expect(report.total).toBe(1);
    expect(report.migrated).toBe(1);
    expect(report.igbBytes).toBeGreaterThan(0);
    expect(report.savedBytes).toBeGreaterThan(0);
    expect(buffers.size).toBe(0);
    expect(save).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('apply mode converts reading.json to .igb, verifies readback, updates DB, and purges legacy PDF', async () => {
    const legacyDoc = makeDoc('2');
    const buffers = new Map<string, Buffer>();
    const jsons = new Map<string, unknown>([[readingJsonKey(2), legacyDoc]]);
    const removed: string[] = [];

    const bookStorage: BookStorage = {
      strategy: 's3',
      persist: vi.fn(),
      remove: vi.fn(async (ref) => {
        if (ref) removed.push(ref);
      }),
      resolveDownload: vi.fn(),
      getJson: vi.fn(async <T>(k: string) => (jsons.get(k) as T) ?? null),
      putBuffer: vi.fn(async (k, data) => {
        buffers.set(k, data);
      }),
      getBuffer: vi.fn(async (k) => buffers.get(k) ?? null),
    };

    const book = {
      id: 2,
      ownerId: 'u2',
      published: false,
      contentTier: 'private_user',
      filePath: 'legacy-2.pdf',
      fileSize: '250000',
      igbPath: null,
    } as Book;

    const booksRepository = {
      find: vi.fn(async () => [book]),
      save: vi.fn(async (b: Book) => b),
    } as unknown as Repository<Book>;

    const report = await migrateBooksToIgb1({
      booksRepository,
      bookStorage,
      dryRun: false,
      purgeLegacy: true,
    });

    expect(report.migrated).toBe(1);
    expect(report.failed).toBe(0);
    expect(book.igbPath).toBe('books/private/u2/2.igb');
    expect(book.filePath).toBe('books/private/u2/2.igb');
    expect(book.igbSize).toBeGreaterThan(0);
    expect(removed).toContain('legacy-2.pdf');
    expect(removed).toContain(readingJsonKey(2));

    // Idempotent second run skips already-migrated book
    const secondRun = await migrateBooksToIgb1({
      booksRepository,
      bookStorage,
      dryRun: false,
      purgeLegacy: true,
    });
    expect(secondRun.skipped).toBe(1);
    expect(secondRun.migrated).toBe(0);
  });
});
