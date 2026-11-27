import 'reflect-metadata';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { Repository } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '../entities/book.entity.js';
import { attachBookFile } from '../lib/book-file.js';
import { resolveReadingDocument } from '../lib/book-reading.js';
import type { BookStorage } from '../storage/book-storage.js';
import type { BookReadingDocument } from '../reading/reading.types.js';
import { IGB1_FLAG_ENCRYPTED } from './igb1.types.js';
import { parseIgb1Header } from './igb1.codec.js';
import { persistBookIgb1, readBookIgb1 } from './igb1.storage.js';

async function samplePdfBuffer(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 6; i++) {
    page.drawText(`${text} Parrafo ${i + 1} con suficiente contenido legible para el extractor.`, {
      x: 50,
      y: 720 - i * 24,
      size: 12,
      font,
    });
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

describe('IGB1 storage integration (S2: no raw PDFs, Tier 1 dedup, Tier 2 encryption)', () => {
  let dir: string;
  let storedBuffers: Map<string, { data: Buffer; cacheControl?: string }>;
  let bookStorage: BookStorage;
  let booksRepository: Repository<Book>;
  let persistSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'igb1-storage-'));
    storedBuffers = new Map();
    persistSpy = vi.fn();

    bookStorage = {
      strategy: 's3',
      persist: persistSpy,
      remove: vi.fn(async () => undefined),
      resolveDownload: vi.fn(),
      putBuffer: vi.fn(async (key, data, opts) => {
        storedBuffers.set(key, { data, cacheControl: opts?.cacheControl });
      }),
      getBuffer: vi.fn(async (key) => storedBuffers.get(key)?.data ?? null),
    };

    booksRepository = {
      save: vi.fn(async (b: Book) => b),
    } as unknown as Repository<Book>;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stores only .igb (never raw PDF) for Tier 2 private books, encrypts it, and deletes temp file', async () => {
    const pdfPath = join(dir, 'private.pdf');
    const pdfBytes = await samplePdfBuffer(
      'En un lugar de la Mancha, de cuyo nombre no quiero acordarme, vivia un hidalgo.',
    );
    await writeFile(pdfPath, pdfBytes);

    const book = {
      id: 10,
      ownerId: 'user-1',
      title: 'Don Quijote',
      author: 'Cervantes',
      published: false,
      contentTier: 'private_user',
    } as Book;

    const saved = await attachBookFile(booksRepository, bookStorage, book, {
      path: pdfPath,
      originalname: 'private.pdf',
      size: pdfBytes.byteLength,
      mimetype: 'application/pdf',
    });

    // Raw PDF was NEVER persisted and temp file was deleted
    expect(persistSpy).not.toHaveBeenCalled();
    await expect(access(pdfPath)).rejects.toThrow();

    expect(saved.contentTier).toBe('private_user');
    expect(saved.igbPath).toBe('books/private/user-1/10.igb');
    expect(saved.filePath).toBe('books/private/user-1/10.igb');
    expect(saved.igbSize).toBeGreaterThan(0);

    const entry = storedBuffers.get('books/private/user-1/10.igb');
    expect(entry).toBeDefined();
    expect(entry?.cacheControl).toBe('private, no-store');
    const header = parseIgb1Header(entry!.data);
    expect(Boolean(header.flags & IGB1_FLAG_ENCRYPTED)).toBe(true);

    // Reading document resolves directly from .igb
    const doc = await resolveReadingDocument(saved.id, saved.filePath!, bookStorage, saved);
    expect(doc.chunks.length).toBeGreaterThan(0);
    expect(doc.chunks.map((c) => c.text).join(' ')).toContain('Mancha');
  });

  it('deduplicates Tier 1 public_open books by contentHash with immutable cache-control', async () => {
    const sharedDoc: BookReadingDocument = {
      bookId: '21',
      pdfPages: 2,
      ocrPending: false,
      extractorVersion: 3,
      chunks: [
        {
          id: 'c-1',
          type: 'para',
          page: 1,
          offset: 0,
          text: 'Texto de dominio público compartido entre dos registros distintos.',
          mood: 'espera',
          cues: [],
          align: 'left',
        },
      ],
    };

    const bookA = {
      id: 21,
      ownerId: 'admin',
      published: true,
      contentTier: 'public_open' as const,
    };

    const bookB = {
      id: 22,
      ownerId: 'user-2',
      published: true,
      contentTier: 'public_open' as const,
    };

    const resA = await persistBookIgb1(bookStorage, bookA, sharedDoc);
    const resB = await persistBookIgb1(bookStorage, bookB, { ...sharedDoc, bookId: '22' });

    expect(resA.contentTier).toBe('public_open');
    expect(resA.igbPath).toMatch(/^books\/public\/[a-f0-9]{64}\.igb$/);
    expect(resB.contentHash).toBe(resA.contentHash);
    expect(resB.igbPath).toBe(resA.igbPath);

    const stored = storedBuffers.get(resA.igbPath);
    expect(stored?.cacheControl).toBe('public, max-age=31536000, immutable');
    const header = parseIgb1Header(stored!.data);
    expect(Boolean(header.flags & IGB1_FLAG_ENCRYPTED)).toBe(false);

    const readBackB = await readBookIgb1(bookStorage, { ...bookB, igbPath: resB.igbPath, filePath: resB.igbPath });
    expect(readBackB?.bookId).toBe('22');
    expect(readBackB?.chunks[0].text).toBe(sharedDoc.chunks[0].text);
  });

  it('deletes temp file even when putBuffer fails with 502', async () => {
    const pdfPath = join(dir, 'fail.pdf');
    const bytes = await samplePdfBuffer(
      'Contenido valido para pasar extraccion y legibilidad antes de simular fallo de S3.',
    );
    await writeFile(pdfPath, bytes);

    bookStorage.putBuffer = vi.fn(async () => {
      throw new Error('R2 down');
    });

    const book = {
      id: 30,
      ownerId: 'user-3',
      title: 'Fail',
      author: 'Autor',
      published: false,
    } as Book;

    await expect(
      attachBookFile(booksRepository, bookStorage, book, {
        path: pdfPath,
        originalname: 'fail.pdf',
        size: bytes.byteLength,
        mimetype: 'application/pdf',
      }),
    ).rejects.toMatchObject({ status: 502 });

    await expect(access(pdfPath)).rejects.toThrow();
  });
});
