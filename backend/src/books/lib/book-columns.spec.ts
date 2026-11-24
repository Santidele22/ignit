import 'reflect-metadata';
import type { Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../users/entities/user.entity.js';
import type { Book } from '../entities/book.entity.js';
import { createBookRow, updateBookRow } from './book-columns.js';

const OWNER = { id: 'user-a', email: 'alice@ignit.app', name: 'Alice', role: 'user' };

const CREATE_DTO = {
  title: 'Clean Code',
  author: 'Robert C. Martin',
  description: 'Manual de artesanía sobre buen código.',
  status: 'reading',
} as never;

function fakeBooksRepository() {
  const create = vi.fn((dto: Partial<Book>) => ({ ...dto }) as Book);
  const save = vi.fn(async (row: Book) => row);
  return { create, save } as unknown as Repository<Book> & {
    create: typeof create;
    save: typeof save;
  };
}

describe('createBookRow review defaults', () => {
  let usersRepository: Repository<User>;

  beforeEach(() => {
    usersRepository = {
      findOne: vi.fn(async () => ({ id: OWNER.id })),
      create: vi.fn((row: Partial<User>) => row),
      save: vi.fn(async (row: User) => row),
    } as unknown as Repository<User>;
  });

  it('starts every new book in the pending review state', async () => {
    const booksRepository = fakeBooksRepository();

    const book = await createBookRow(booksRepository, usersRepository, CREATE_DTO, OWNER);

    expect(book.reviewStatus).toBe('pending');
    expect(book.ownerId).toBe('user-a');
    expect(booksRepository.save).toHaveBeenCalledWith(book);
  });

  it('leaves the review and AI columns alone when metadata is edited', async () => {
    const booksRepository = fakeBooksRepository();
    const book = {
      id: 7,
      ownerId: 'user-a',
      reviewStatus: 'approved',
      reviewedBy: 'admin-1',
      reviewedAt: new Date('2024-05-01T00:00:00.000Z'),
      aiStatus: 'ok',
      aiSafety: 'ok',
    } as Book;
    const merge = vi.fn((row: Book, dto: Partial<Book>) => Object.assign(row, dto));
    (booksRepository as unknown as { merge: typeof merge }).merge = merge;

    const updated = await updateBookRow(booksRepository, book, { title: 'Clean Code 2' } as never);

    expect(merge).toHaveBeenCalledWith(book, { title: 'Clean Code 2' });
    expect(updated.reviewStatus).toBe('approved');
    expect(updated.reviewedBy).toBe('admin-1');
    expect(updated.aiStatus).toBe('ok');
    expect(booksRepository.save).toHaveBeenCalledWith(book);
  });
});
