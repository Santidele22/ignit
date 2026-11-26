import 'reflect-metadata';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookKind } from '../common/enums/book-kind.enum.js';
import { ReadingStatus } from '../common/enums/reading-status.enum.js';
import type { User } from '../users/entities/user.entity.js';
import { BooksService } from './books.service.js';
import type { Book } from './entities/book.entity.js';
import type { DownloadEvent } from './entities/download-event.entity.js';
import type { ReadingState } from './entities/reading-state.entity.js';
import { presentBook } from './http/book-presenter.js';
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
    reviewStatus: overrides.published === true ? 'approved' : 'pending',
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
      increment: vi.fn(
        async (
          criteria: { id: number },
          propertyPath: 'readsStartedCount' | 'offlineDownloadsCount' | 'ctaClicksCount',
          value: number,
        ) => {
          const target = books.find((b) => b.id === criteria.id);
          if (target) {
            target[propertyPath] = Number(target[propertyPath] ?? 0) + value;
          }
          return { affected: target ? 1 : 0 };
        },
      ),
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

  it('restricts direct source PDF download strictly to admins', async () => {
    books.push(bookRow({ id: 8, ownerId: 'user-a', published: true, filePath: 'secret.pdf' }));

    await expect(service.prepareDownload(8, '1.2.3.4', null)).rejects.toThrow(ForbiddenException);
    await expect(
      service.prepareDownload(8, '1.2.3.4', { id: 'user-a', role: 'user' }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.prepareDownload(8, '1.2.3.4', { id: 'user-b', role: 'user' }),
    ).rejects.toThrow(ForbiddenException);

    const adminDl = await service.prepareDownload(8, '1.2.3.4', { id: 'admin-1', role: 'admin' });
    expect(adminDl.filePath).toBe('secret.pdf');
    expect(downloadEvents).toHaveLength(0);
  });

  it('persists and normalizes editorial ficha and CTA fields on create and update', async () => {
    const created = await service.createForUser(
      {
        title: 'Ficciones',
        author: 'Jorge Luis Borges',
        description: 'Cuentos.',
        status: ReadingStatus.QUEUED,
        publisher: '  Editorial Sur  ',
        translator: '   ',
        illustrator: 'Norah Borges',
        isbn: '978-987-0000-00-0',
        license: 'Autorización editorial',
        ctaLabel: 'Comprar libro físico',
        ctaUrl: 'https://editorialsur.example/ficciones',
      },
      { id: 'user-a', email: 'alice@ignit.app', name: 'Alice', role: 'user' },
    );

    expect(created.publisher).toBe('Editorial Sur');
    expect(created.translator).toBeNull();
    expect(created.illustrator).toBe('Norah Borges');
    expect(created.isbn).toBe('978-987-0000-00-0');
    expect(created.license).toBe('Autorización editorial');
    expect(created.ctaLabel).toBe('Comprar libro físico');
    expect(created.ctaUrl).toBe('https://editorialsur.example/ficciones');

    const updated = await service.updateForUser(
      created.id,
      { ctaLabel: '', ctaUrl: '' },
      { id: 'user-a', role: 'user' },
    );
    expect(updated.ctaLabel).toBeNull();
    expect(updated.ctaUrl).toBeNull();
  });

  it('records atomic per-book metrics only for authenticated readers of readable books', async () => {
    books.push(
      bookRow({
        id: 12,
        ownerId: 'user-a',
        published: true,
        readsStartedCount: 0,
        offlineDownloadsCount: 0,
        ctaClicksCount: 0,
      }),
    );
    books.push(bookRow({ id: 13, ownerId: 'user-a', published: false }));

    // The anonymous demo showcase persists nothing: any metric ping without
    // a session is rejected and leaves every counter untouched.
    await expect(service.recordMetric(12, 'read_started', null)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(books[0].readsStartedCount).toBe(0);

    await service.recordMetric(12, 'read_started', { id: 'user-b', role: 'user' });
    await service.recordMetric(12, 'offline_download', { id: 'user-b', role: 'user' });
    await service.recordMetric(12, 'cta_click', { id: 'user-a', role: 'user' });

    expect(books[0].readsStartedCount).toBe(1);
    expect(books[0].offlineDownloadsCount).toBe(1);
    expect(books[0].ctaClicksCount).toBe(1);

    // Private books are not readable by others (404 hides existence).
    await expect(
      service.recordMetric(13, 'read_started', { id: 'user-b', role: 'user' }),
    ).rejects.toThrow(NotFoundException);

    // presentBook strips internal metric counters from public/owner payloads
    const presented = presentBook(books[0], null);
    expect(presented).not.toHaveProperty('readsStartedCount');
    expect(presented).not.toHaveProperty('offlineDownloadsCount');
    expect(presented).not.toHaveProperty('ctaClicksCount');
  });

  it('prevents non-admin owners from re-publishing a book taken down by admin', async () => {
    books.push(
      bookRow({
        id: 20,
        ownerId: 'user-a',
        published: false,
        reviewStatus: 'rejected',
        license: 'CC BY 4.0',
      }),
    );

    await expect(
      service.updateForUser(20, { published: true }, { id: 'user-a', role: 'user' }),
    ).rejects.toThrow(ForbiddenException);

    const republishedByAdmin = await service.updateForUser(
      20,
      { published: true },
      { id: 'admin-1', role: 'admin' },
    );
    expect(republishedByAdmin.published).toBe(true);
    expect(republishedByAdmin.reviewStatus).toBe('approved');
  });

  it('enforces open license and admin approval for public catalog while keeping private books unrestricted', async () => {
    // Private book without license succeeds
    const privateBook = await service.createForUser(
      {
        title: 'Apuntes personales',
        author: 'Yo',
        description: 'Lectura privada.',
        status: ReadingStatus.QUEUED,
        published: false,
      },
      { id: 'user-a', role: 'user' },
    );
    expect(privateBook.published).toBe(false);
    expect(privateBook.license ?? null).toBeNull();

    // Requesting public catalog without an open license fails with 400
    await expect(
      service.createForUser(
        {
          title: 'Novela con copyright',
          author: 'Autor',
          description: 'Sin licencia abierta.',
          status: ReadingStatus.QUEUED,
          published: true,
          license: 'Todos los derechos reservados',
        },
        { id: 'user-a', role: 'user' },
      ),
    ).rejects.toThrow(BadRequestException);

    // Non-admin requesting publication with an open license stays private + pending admin review
    const pendingPublic = await service.createForUser(
      {
        title: 'Libro libre',
        author: 'Comunidad',
        description: 'Manual CC BY.',
        status: ReadingStatus.QUEUED,
        published: true,
        license: 'CC BY 4.0',
      },
      { id: 'user-a', role: 'user' },
    );
    expect(pendingPublic.published).toBe(false);
    expect(pendingPublic.reviewStatus).toBe('pending');

    // Non-admin cannot self-publish via PATCH while pending
    await expect(
      service.updateForUser(pendingPublic.id, { published: true }, { id: 'user-a', role: 'user' }),
    ).rejects.toThrow(ForbiddenException);

    // Admin can publish an open-license book and clearing its license afterwards is rejected
    const publishedByAdmin = await service.updateForUser(
      pendingPublic.id,
      { published: true },
      { id: 'admin-1', role: 'admin' },
    );
    expect(publishedByAdmin.published).toBe(true);
    expect(publishedByAdmin.reviewStatus).toBe('approved');

    await expect(
      service.updateForUser(pendingPublic.id, { license: '' }, { id: 'admin-1', role: 'admin' }),
    ).rejects.toThrow(BadRequestException);

    // Unapproved published row cannot be read by anonymous or non-owners (404)
    books.push(
      bookRow({
        id: 99,
        ownerId: 'user-a',
        published: true,
        reviewStatus: 'pending',
        license: 'CC BY 4.0',
      }),
    );
    await expect(service.findOneForReader(99, null)).rejects.toThrow(NotFoundException);
    await expect(service.findOneForReader(99, { id: 'user-b', role: 'user' })).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.findOneForReader(99, { id: 'user-a', role: 'user' })).resolves.toMatchObject({
      id: 99,
    });

    // Non-admin cannot self-publish even if reviewStatus is 'approved' (must be published by admin)
    books.push(
      bookRow({
        id: 100,
        ownerId: 'user-a',
        published: false,
        reviewStatus: 'approved',
        license: 'CC BY 4.0',
      }),
    );
    await expect(
      service.updateForUser(100, { published: true }, { id: 'user-a', role: 'user' }),
    ).rejects.toThrow(ForbiddenException);
  });
});
