import 'reflect-metadata';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookKind } from '../common/enums/book-kind.enum.js';
import { ReadingStatus } from '../common/enums/reading-status.enum.js';
import type { User } from '../users/entities/user.entity.js';
import { BooksService } from './books.service.js';
import type { Book } from './entities/book.entity.js';
import type { DownloadEvent } from './entities/download-event.entity.js';
import type { ReadingState } from './entities/reading-state.entity.js';
import type { BookStorage } from './storage/book-storage.js';

function bookRow(overrides: Partial<Book> = {}): Book {
  return {
    id: 1,
    title: 'Dune',
    author: 'Frank Herbert',
    description: 'Ciencia ficción en Arrakis.',
    status: ReadingStatus.QUEUED,
    kind: BookKind.NO_TECNICO,
    published: false,
    ownerId: 'user-a',
    filePath: 'dune.pdf',
    originalName: 'dune.pdf',
    mimeType: 'application/pdf',
    ...overrides,
  } as Book;
}

describe('BooksService multi-user isolation and reading state', () => {
  let books: Book[];
  let users: Map<string, User>;
  let readingStates: ReadingState[];
  let downloadEvents: DownloadEvent[];
  let service: BooksService;

  beforeEach(() => {
    books = [];
    users = new Map();
    readingStates = [];
    downloadEvents = [];

    const booksRepo = {
      findOne: vi.fn(async ({ where }: { where: { id?: number } }) =>
        books.find((b) => b.id === where.id) ?? null,
      ),
      find: vi.fn(async () => books),
      count: vi.fn(async () => books.length),
      create: vi.fn((dto: Partial<Book>) => ({ id: books.length + 1, ...dto })),
      save: vi.fn(async (book: Book) => {
        const idx = books.findIndex((b) => b.id === book.id);
        if (idx >= 0) books[idx] = book;
        else books.push(book);
        return book;
      }),
      merge: vi.fn((book: Book, dto: Partial<Book>) => Object.assign(book, dto)),
      delete: vi.fn(async (id: number) => {
        books = books.filter((b) => b.id !== id);
        return { affected: 1 };
      }),
    } as unknown as Repository<Book>;

    const downloadEventsRepo = {
      count: vi.fn(async () => downloadEvents.length),
      create: vi.fn((dto: Partial<DownloadEvent>) => ({ id: downloadEvents.length + 1, ...dto })),
      save: vi.fn(async (evt: DownloadEvent) => {
        downloadEvents.push(evt);
        return evt;
      }),
    } as unknown as Repository<DownloadEvent>;

    const readingStatesRepo = {
      findOne: vi.fn(async ({ where }: { where: { userId?: string; bookId?: number } }) =>
        readingStates.find((rs) => rs.userId === where.userId && rs.bookId === where.bookId) ?? null,
      ),
      create: vi.fn((dto: Partial<ReadingState>) => ({ id: readingStates.length + 1, ...dto })),
      save: vi.fn(async (rs: ReadingState) => {
        const idx = readingStates.findIndex(
          (row) => row.userId === rs.userId && row.bookId === rs.bookId,
        );
        if (idx >= 0) readingStates[idx] = rs;
        else readingStates.push(rs);
        return rs;
      }),
      delete: vi.fn(async (criteria: { bookId?: number }) => {
        readingStates = readingStates.filter((rs) => rs.bookId !== criteria.bookId);
        return { affected: 1 };
      }),
    } as unknown as Repository<ReadingState>;

    const usersRepo = {
      findOne: vi.fn(async ({ where }: { where: { id?: string } }) =>
        where.id ? (users.get(where.id) ?? null) : null,
      ),
      create: vi.fn((dto: Partial<User>) => dto as User),
      save: vi.fn(async (user: User) => {
        users.set(user.id, user);
        return user;
      }),
    } as unknown as Repository<User>;

    const storage: BookStorage = {
      strategy: 'local',
      persist: vi.fn(async () => 'stored.pdf'),
      remove: vi.fn(async () => undefined),
      resolveDownload: vi.fn(),
    };

    service = new BooksService(
      booksRepo,
      downloadEventsRepo,
      readingStatesRepo,
      usersRepo,
      storage,
    );
  });

  it('auto-provisions missing user row via ensureUserExists and binds ownerId strictly from session', async () => {
    const created = await service.createForUser(
      {
        title: 'Clean Architecture',
        author: 'Robert C. Martin',
        description: 'Arquitectura de software.',
        status: ReadingStatus.QUEUED,
      },
      { id: 'user-a', email: 'alice@ignit.app', name: 'Alice', role: 'user' },
    );

    expect(created.ownerId).toBe('user-a');
    expect(users.get('user-a')).toMatchObject({
      id: 'user-a',
      email: 'alice@ignit.app',
      name: 'Alice',
    });
  });

  it('hides private books (404) from anonymous and non-owners, while allowing owner and admin', async () => {
    books.push(bookRow({ id: 10, ownerId: 'user-a', published: false }));

    await expect(service.findOneForReader(10, null)).rejects.toThrow(NotFoundException);
    await expect(service.findOneForReader(10, { id: 'user-b', role: 'user' })).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.findOneForReader(10, { id: 'user-a', role: 'user' })).resolves.toMatchObject({
      id: 10,
      ownerId: 'user-a',
    });
    await expect(service.findOneForReader(10, { id: 'admin-1', role: 'admin' })).resolves.toMatchObject({
      id: 10,
    });
  });

  it('enforces mutation ownership: 404 on private book, 403 on published book of another user', async () => {
    books.push(bookRow({ id: 1, ownerId: 'user-a', published: false }));
    books.push(bookRow({ id: 2, ownerId: 'user-a', published: true }));

    await expect(
      service.updateForUser(1, { title: 'Hacked' }, { id: 'user-b', role: 'user' }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.updateForUser(2, { title: 'Hacked' }, { id: 'user-b', role: 'user' }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.removeForUser(2, { id: 'user-b', role: 'user' }),
    ).rejects.toThrow(ForbiddenException);

    const updated = await service.updateForUser(1, { title: 'Updated' }, { id: 'user-a', role: 'user' });
    expect(updated.title).toBe('Updated');
  });

  it('isolates reading states per user and updates book.status ONLY when the owner reads', async () => {
    books.push(bookRow({ id: 5, ownerId: 'user-a', published: true, status: ReadingStatus.QUEUED }));

    await expect(service.getReadingState(5, null)).rejects.toThrow(UnauthorizedException);

    // User B finishes User A's published book
    const stateB = await service.updateReadingState(
      5,
      {
        progress: { page: 120, pct: 100, chunkId: 'c-120' },
        marks: [{ id: 'm1', kind: 'underline', anchor: 'c-10', text: 'Note B' }],
        words: [{ term: 'Kwisatz', trans: 'acortar el camino' }],
      },
      { id: 'user-b', email: 'bob@ignit.app', name: 'Bob', role: 'user' },
    );

    expect(stateB.progress.pct).toBe(100);
    // User A's book status must remain QUEUED!
    expect(books[0].status).toBe(ReadingStatus.QUEUED);

    // User A's reading state is untouched/empty, then updated independently
    const emptyStateA = await service.getReadingState(5, { id: 'user-a', role: 'user' });
    expect(emptyStateA.marks).toEqual([]);
    expect(emptyStateA.progress).toEqual({ page: 1, pct: 0 });
    expect(emptyStateA.status).toBe(ReadingStatus.QUEUED);

    // Even if User A's book is already finished, a brand-new reader (User C) starts with status=queued
    books[0].status = ReadingStatus.FINISHED;
    const bookFinishedCStart = await service.getReadingState(5, { id: 'user-c', role: 'user' });
    expect(bookFinishedCStart.status).toBe(ReadingStatus.QUEUED);
    books[0].status = ReadingStatus.QUEUED;

    const stateA = await service.updateReadingState(
      5,
      { progress: { page: 12, pct: 25 } },
      { id: 'user-a', email: 'alice@ignit.app', name: 'Alice', role: 'user' },
    );
    expect(stateA.marks).toEqual([]);
    expect(books[0].status).toBe(ReadingStatus.READING);

    // Re-reading User B preserves Bob's marks and words untouched
    const reloadedB = await service.getReadingState(5, { id: 'user-b', role: 'user' });
    expect(reloadedB.marks).toHaveLength(1);
    expect(reloadedB.words[0].term).toBe('Kwisatz');
  });

  it('allows owner to download their own private PDF without hitting anonymous rate limit', async () => {
    books.push(bookRow({ id: 8, ownerId: 'user-a', published: false, filePath: 'secret.pdf' }));

    await expect(service.prepareDownload(8, '1.2.3.4', null)).rejects.toThrow(NotFoundException);
    const ownerDl = await service.prepareDownload(8, '1.2.3.4', { id: 'user-a', role: 'user' });
    expect(ownerDl.filePath).toBe('secret.pdf');
    expect(downloadEvents).toHaveLength(0);
  });
});
