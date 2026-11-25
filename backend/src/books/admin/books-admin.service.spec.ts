import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import type { Repository } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '../entities/book.entity.js';
import type { BookStorage } from '../storage/book-storage.js';
import type { User } from '../../users/entities/user.entity.js';
import { BooksAdminService } from './books-admin.service.js';
import { AdminBooksQueryDto } from './dto/admin-books-query.dto.js';

function bookRow(overrides: Partial<Book> = {}): Book {
  return {
    id: 7,
    title: 'Clean Code',
    author: 'Robert C. Martin',
    kind: 'tecnico',
    published: false,
    ownerId: 'user-a',
    filePath: 'uploads/books/clean-code.pdf',
    originalName: 'clean-code.pdf',
    fileSize: '2048',
    filePages: 12,
    mimeType: 'application/pdf',
    reviewStatus: 'pending',
    reviewNote: null,
    reviewedBy: null,
    reviewedAt: null,
    aiSafety: null,
    aiQuality: null,
    aiNotes: null,
    aiStatus: 'skipped',
    readsStartedCount: 0,
    offlineDownloadsCount: 0,
    ctaClicksCount: 0,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  } as Book;
}

describe('BooksAdminService', () => {
  let find: ReturnType<typeof vi.fn>;
  let count: ReturnType<typeof vi.fn>;
  let findOne: ReturnType<typeof vi.fn>;
  let save: ReturnType<typeof vi.fn>;
  let getJson: ReturnType<typeof vi.fn>;
  let bookStorage: BookStorage;
  let service: BooksAdminService;
  let dir: string;
  let previousUploadDir: string | undefined;

  beforeEach(async () => {
    previousUploadDir = process.env.BOOKS_UPLOAD_DIR;
    dir = await mkdtemp(join(tmpdir(), 'admin-firewall-'));
    process.env.BOOKS_UPLOAD_DIR = dir;
    find = vi.fn(async () => []);
    count = vi.fn(async () => 0);
    findOne = vi.fn(async () => null);
    save = vi.fn(async (row: Book) => row);
    getJson = vi.fn(async () => null);
    bookStorage = { strategy: 's3', getJson } as unknown as BookStorage;
    service = new BooksAdminService(
      {
        find,
        count,
        findOne,
        save,
      } as unknown as Repository<Book>,
      bookStorage,
    );
  });

  describe('firewall (pipeline report endpoint)', () => {
    it('answers the stored pipeline report of one book', async () => {
      findOne = vi.fn(async () => bookRow());
      const report = {
        schemaVersion: 1,
        safe: true,
        pageCount: 12,
        violations: [],
        tiers: [],
      } as const;
      getJson = vi.fn(async () => report);
      bookStorage = { strategy: 's3', getJson } as unknown as BookStorage;
      service = new BooksAdminService(
        { find, count, findOne, save } as unknown as Repository<Book>,
        bookStorage,
      );

      await expect(service.firewall(7)).resolves.toBe(report);
      expect(findOne).toHaveBeenCalledWith({ where: { id: 7 } });
    });

    it('404s when the book is unknown', async () => {
      await expect(service.firewall(4242)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('404s when the book exists but has no firewall report', async () => {
      findOne = vi.fn(async () => bookRow());
      service = new BooksAdminService(
        { find, count, findOne, save } as unknown as Repository<Book>,
        bookStorage,
      );

      await expect(service.firewall(7)).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  afterEach(async () => {
    if (previousUploadDir === undefined) {
      delete process.env.BOOKS_UPLOAD_DIR;
    } else {
      process.env.BOOKS_UPLOAD_DIR = previousUploadDir;
    }
    await rm(dir, { recursive: true, force: true });
  });

  describe('list', () => {
    it('windows the pending review queue with page/pageSize and joins the owner email', async () => {
      const owner = { id: 'user-a', name: 'Alice', email: 'alice@ignit.app' } as User;
      const rows = [bookRow({ owner })];
      find.mockResolvedValue(rows);
      count.mockResolvedValue(6);
      const query = plainToInstance(AdminBooksQueryDto, {
        review: 'pending',
        page: '2',
        pageSize: '2',
      });

      const page = await service.list(query);

      expect(find).toHaveBeenCalledWith({
        where: { reviewStatus: 'pending' },
        order: { id: 'ASC' },
        relations: { owner: true },
        skip: 2,
        take: 2,
      });
      expect(count).toHaveBeenCalledWith({ where: { reviewStatus: 'pending' } });
      expect(page.total).toBe(6);
      expect(page.offset).toBe(2);
      expect(page.limit).toBe(2);
      expect(page.items[0]).toMatchObject({
        id: 7,
        title: 'Clean Code',
        author: 'Robert C. Martin',
        kind: 'tecnico',
        ownerId: 'user-a',
        ownerEmail: 'alice@ignit.app',
        fileSize: '2048',
        filePages: 12,
        reviewStatus: 'pending',
        aiStatus: 'skipped',
      });
    });

    it('lists every review state when no review filter is sent, defaulting to the first page', async () => {
      find.mockResolvedValue([bookRow({ owner: null })]);
      count.mockResolvedValue(1);

      const page = await service.list(plainToInstance(AdminBooksQueryDto, {}));

      expect(find).toHaveBeenCalledWith({
        where: {},
        order: { id: 'ASC' },
        relations: { owner: true },
        skip: 0,
        take: 20,
      });
      expect(page.items[0]?.ownerEmail).toBeNull();
      expect(page.offset).toBe(0);
      expect(page.limit).toBe(20);
    });

    it('filters by published state and exposes editorial and metric counters', async () => {
      find.mockResolvedValue([
        bookRow({
          published: true,
          publisher: 'Editorial Chica',
          license: 'CC BY 4.0',
          ctaLabel: 'Comprar físico',
          ctaUrl: 'https://editorial.test/libro',
          readsStartedCount: 14,
          offlineDownloadsCount: 5,
          ctaClicksCount: 3,
        }),
      ]);
      count.mockResolvedValue(1);

      const page = await service.list(
        plainToInstance(AdminBooksQueryDto, { published: 'true' }),
      );

      expect(find).toHaveBeenCalledWith({
        where: { published: true },
        order: { id: 'ASC' },
        relations: { owner: true },
        skip: 0,
        take: 20,
      });
      expect(page.items[0]).toMatchObject({
        published: true,
        publisher: 'Editorial Chica',
        license: 'CC BY 4.0',
        ctaLabel: 'Comprar físico',
        ctaUrl: 'https://editorial.test/libro',
        readsStartedCount: 14,
        offlineDownloadsCount: 5,
        ctaClicksCount: 3,
      });
    });
  });

  describe('review', () => {
    it('records the approving admin, the timestamp and leaves publishing opt-in', async () => {
      const book = bookRow({ published: false });
      findOne.mockResolvedValue(book);

      const reviewed = await service.review(7, { decision: 'approved' }, 'admin-1');

      expect(book.reviewStatus).toBe('approved');
      expect(book.reviewedBy).toBe('admin-1');
      expect(book.reviewedAt).toBeInstanceOf(Date);
      expect(book.reviewNote).toBeNull();
      expect(book.published).toBe(false);
      expect(save).toHaveBeenCalledWith(book);
      expect(reviewed).toMatchObject({ reviewStatus: 'approved', reviewedBy: 'admin-1' });
    });

    it('publishes only when the explicit publish flag is sent and the book has an open license', async () => {
      const book = bookRow({ published: false, license: 'Dominio público' });
      findOne.mockResolvedValue(book);

      await service.review(7, { decision: 'approved', publish: true }, 'admin-1');

      expect(book.reviewStatus).toBe('approved');
      expect(book.published).toBe(true);
    });

    it('rejects publishing on approval when the book lacks an open license', async () => {
      const book = bookRow({ published: false, license: null });
      findOne.mockResolvedValue(book);

      await expect(
        service.review(7, { decision: 'approved', publish: true }, 'admin-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(book.published).toBe(false);
      expect(save).not.toHaveBeenCalled();
    });

    it('rejects approving an already-published book that lacks an open license', async () => {
      const book = bookRow({ published: true, reviewStatus: 'pending', license: null });
      findOne.mockResolvedValue(book);

      await expect(
        service.review(7, { decision: 'approved' }, 'admin-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(save).not.toHaveBeenCalled();
    });

    it('rejects with the note, unpublishing whatever was published before', async () => {
      const book = bookRow({ published: true });
      findOne.mockResolvedValue(book);

      const reviewed = await service.review(
        7,
        { decision: 'rejected', note: '  Contenido violento sin contexto  ' },
        'admin-1',
      );

      expect(book.reviewStatus).toBe('rejected');
      expect(book.reviewNote).toBe('Contenido violento sin contexto');
      expect(book.published).toBe(false);
      expect(book.reviewedBy).toBe('admin-1');
      expect(reviewed.published).toBe(false);
    });

    it('answers 400 for a decision outside approved/rejected', async () => {
      findOne.mockResolvedValue(bookRow());

      const error = await service
        .review(7, { decision: 'maybe' as never }, 'admin-1')
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect(save).not.toHaveBeenCalled();
    });

    it('answers 404 for a book that does not exist', async () => {
      findOne.mockResolvedValue(null);

      await expect(
        service.review(99, { decision: 'approved' }, 'admin-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('unpublish', () => {
    it('immediately unpublishes a book and records reviewer and optional takedown note', async () => {
      const book = bookRow({ published: true, reviewStatus: 'approved' });
      findOne.mockResolvedValue(book);

      const result = await service.unpublish(7, { note: '  Pedido de editorial  ' }, 'admin-1');

      expect(book.published).toBe(false);
      expect(book.reviewedBy).toBe('admin-1');
      expect(book.reviewedAt).toBeInstanceOf(Date);
      expect(book.reviewNote).toBe('Pedido de editorial');
      expect(save).toHaveBeenCalledWith(book);
      expect(result.published).toBe(false);
    });

    it('answers 404 when the book does not exist', async () => {
      findOne.mockResolvedValue(null);

      await expect(service.unpublish(404, {}, 'admin-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('reading chunks editor', () => {
    it('lists filtered chunks and applies manual reclassify/drop patches without AI length limits', async () => {
      const book = bookRow();
      findOne.mockResolvedValue(book);
      const readingDoc = {
        bookId: '7',
        pdfPages: 10,
        ocrPending: false,
        extractorVersion: 1,
        chunks: [
          {
            id: 'p0001.0000',
            type: 'heading',
            level: 2,
            page: 1,
            offset: 0,
            text: 'E2 a E3',
            mood: 'espera',
            cues: [],
          },
          {
            id: 'p0001.0010',
            type: 'para',
            page: 1,
            offset: 10,
            text: 'Créditos Editoriales '.repeat(15).trim(),
            mood: 'espera',
            cues: [],
          },
          {
            id: 'p0002.0000',
            type: 'para',
            page: 2,
            offset: 0,
            text: 'Capítulo I: La estrategia.',
            mood: 'espera',
            cues: [],
          },
        ],
      };
      const putJson = vi.fn(async () => undefined);
      getJson = vi.fn(async (key: string) =>
        key.endsWith('reading.json') ? readingDoc : null,
      );
      bookStorage = { strategy: 's3', getJson, putJson } as unknown as BookStorage;
      service = new BooksAdminService(
        { find, count, findOne, save } as unknown as Repository<Book>,
        bookStorage,
      );

      const list = await service.getReadingChunks(7, { page: 1 });
      expect(list.totalChunks).toBe(3);
      expect(list.filteredTotal).toBe(2);
      expect(list.chunks.map((c) => c.id)).toEqual(['p0001.0000', 'p0001.0010']);

      const patched = await service.patchReadingChunks(7, [
        { op: 'drop', id: 'p0001.0000' },
        { op: 'reclassify', id: 'p0001.0010', type: 'meta' },
      ]);
      expect(patched).toMatchObject({
        bookId: 7,
        applied: true,
        dropped: 1,
        reclassified: 1,
        totalChunks: 2,
      });
      expect(putJson).toHaveBeenCalled();
    });
  });
});
