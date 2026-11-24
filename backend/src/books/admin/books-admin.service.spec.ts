import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import type { Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '../entities/book.entity.js';
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
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  } as Book;
}

describe('BooksAdminService', () => {
  let find: ReturnType<typeof vi.fn>;
  let count: ReturnType<typeof vi.fn>;
  let findOne: ReturnType<typeof vi.fn>;
  let save: ReturnType<typeof vi.fn>;
  let service: BooksAdminService;

  beforeEach(() => {
    find = vi.fn(async () => []);
    count = vi.fn(async () => 0);
    findOne = vi.fn(async () => null);
    save = vi.fn(async (row: Book) => row);
    service = new BooksAdminService({
      find,
      count,
      findOne,
      save,
    } as unknown as Repository<Book>);
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

    it('publishes only when the explicit publish flag is sent', async () => {
      const book = bookRow({ published: false });
      findOne.mockResolvedValue(book);

      await service.review(7, { decision: 'approved', publish: true }, 'admin-1');

      expect(book.reviewStatus).toBe('approved');
      expect(book.published).toBe(true);
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
});
