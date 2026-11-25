import 'reflect-metadata';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaginationQueryDto } from '../common/pagination/pagination.dto.js';
import { ReadingStatus } from '../common/enums/reading-status.enum.js';
import { BooksService } from './books.service.js';
import type { BookStorage } from './storage/book-storage.js';
import type { Book } from './entities/book.entity.js';
import type { DownloadEvent } from './entities/download-event.entity.js';
import type { ReadingState } from './entities/reading-state.entity.js';
import type { User } from '../users/entities/user.entity.js';

function bookRow(overrides: Partial<Book> = {}): Book {
  return {
    id: 7,
    title: 'Clean Code',
    filePath: null,
    originalName: null,
    fileSize: null,
    mimeType: null,
    published: false,
    ownerId: 'dev-test-user',
    ...overrides,
  } as Book;
}

const OWNER = { id: 'dev-test-user', email: 'owner@ignit.local', name: 'Owner', role: 'user' };

describe('BooksService storage interplay', () => {
  let dir: string;
  let findOneBook: ReturnType<typeof vi.fn>;
  let findBooks: ReturnType<typeof vi.fn>;
  let countBooks: ReturnType<typeof vi.fn>;
  let saveBook: ReturnType<typeof vi.fn>;
  let deleteBook: ReturnType<typeof vi.fn>;
  let countEvents: ReturnType<typeof vi.fn>;
  let saveEvent: ReturnType<typeof vi.fn>;
  let readingStatesRepo: Repository<ReadingState>;
  let booksRepository: Repository<Book>;
  let downloadEventsRepository: Repository<DownloadEvent>;
  let usersRepository: Repository<User>;
  let storage: BookStorage & { persist: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  let service: BooksService;

  let previousUploadDir: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'books-service-'));
    previousUploadDir = process.env.BOOKS_UPLOAD_DIR;
    process.env.BOOKS_UPLOAD_DIR = dir;
    findOneBook = vi.fn();
    saveBook = vi.fn(async (book: Book) => book);
    deleteBook = vi.fn(async () => ({}));
    countEvents = vi.fn(async () => 0);
    saveEvent = vi.fn(async (event: unknown) => event);
    findBooks = vi.fn();
    countBooks = vi.fn();
    booksRepository = {
      findOne: findOneBook,
      find: findBooks,
      count: countBooks,
      create: vi.fn((dto) => ({ ...dto })),
      save: saveBook,
      merge: vi.fn(),
      delete: deleteBook,
    } as unknown as Repository<Book>;
    downloadEventsRepository = {
      count: countEvents,
      save: saveEvent,
      create: vi.fn((dto) => ({ ...dto })),
    } as unknown as Repository<DownloadEvent>;
    readingStatesRepo = {
      findOne: vi.fn(async () => null),
      create: vi.fn((dto) => ({ ...dto })),
      save: vi.fn(async (rs) => rs),
      delete: vi.fn(async () => ({ affected: 1 })),
    } as unknown as Repository<ReadingState>;
    usersRepository = {
      findOne: vi.fn(async () => ({ id: 'dev-test-user' })),
      save: vi.fn(),
      create: vi.fn((dto) => ({ ...dto })),
    } as unknown as Repository<User>;
    storage = {
      strategy: 's3',
      persist: vi.fn(async () => '1730000000000-deadbeefcafe.pdf'),
      remove: vi.fn(async () => undefined),
      resolveDownload: vi.fn(),
    };
    service = new BooksService(
      booksRepository,
      downloadEventsRepository,
      readingStatesRepo,
      usersRepository,
      storage,
    );
  });

  afterEach(async () => {
    if (previousUploadDir === undefined) {
      delete process.env.BOOKS_UPLOAD_DIR;
    } else {
      process.env.BOOKS_UPLOAD_DIR = previousUploadDir;
    }
    await rm(dir, { recursive: true, force: true });
  });

  const uploadedFile = async () => {
    const path = join(dir, 'temp.pdf');
    // A structurally valid PDF: the firewall parses every upload with `pdf-lib`
    // before it may reach storage, so a header-only stub is rejected.
    const doc = await PDFDocument.create();
    doc.addPage();
    await writeFile(path, await doc.save({ useObjectStreams: false }));
    return { path, originalname: 'clean-code.pdf', size: 9, mimetype: 'application/pdf' };
  };

  it('persists to storage before saving the row, then drops the temp file', async () => {
    findOneBook.mockResolvedValue(bookRow());
    const file = await uploadedFile();
    const calls: string[] = [];
    storage.persist.mockImplementation(async () => {
      calls.push('persist');
      return '1730000000000-deadbeefcafe.pdf';
    });
    saveBook.mockImplementation(async (book: Book) => {
      calls.push('save');
      return book;
    });

    const saved = await service.attachFileForUser(7, file, OWNER);

    expect(calls).toEqual(['persist', 'save']);
    expect(saved.filePath).toBe('1730000000000-deadbeefcafe.pdf');
    expect(saved.originalName).toBe('clean-code.pdf');
    expect(saved.fileSize).toBe('9');
    expect(saved.mimeType).toBe('application/pdf');
  });

  it('answers 502 and cleans the temp file when storage rejects; the row is untouched', async () => {
    findOneBook.mockResolvedValue(bookRow());
    storage.persist.mockRejectedValue(new Error('S3 unavailable'));
    const file = await uploadedFile();

    await expect(service.attachFileForUser(7, file, OWNER)).rejects.toMatchObject({ status: 502 });
    expect(saveBook).not.toHaveBeenCalled();
    await expect(access(file.path)).rejects.toThrow();
  });

  it('removes the just-uploaded object when the row save fails', async () => {
    findOneBook.mockResolvedValue(bookRow());
    saveBook.mockRejectedValue(new Error('connection lost'));

    await expect(service.attachFileForUser(7, await uploadedFile(), OWNER)).rejects.toThrow(
      'connection lost',
    );
    expect(storage.remove).toHaveBeenCalledWith('1730000000000-deadbeefcafe.pdf');
  });

  it('removes the replaced file only after the new reference is saved', async () => {
    findOneBook.mockResolvedValue(bookRow({ filePath: 'uploads/books/old.pdf' }));
    const calls: string[] = [];
    saveBook.mockImplementation(async (book: Book) => {
      calls.push('save');
      return book;
    });
    storage.remove.mockImplementation(async () => {
      calls.push('remove');
    });

    await service.attachFileForUser(7, await uploadedFile(), OWNER);

    expect(calls).toEqual(['save', 'remove']);
    expect(storage.remove).toHaveBeenCalledWith('uploads/books/old.pdf');
  });

  it('removes the stored file when the book is deleted', async () => {
    findOneBook.mockResolvedValue(bookRow({ filePath: '1730000000000-deadbeefcafe.pdf' }));

    await service.removeForUser(7, OWNER);

    expect(storage.remove).toHaveBeenCalledWith('1730000000000-deadbeefcafe.pdf');
    expect(deleteBook).toHaveBeenCalledWith(7);
  });

  it('keeps prepareDownload returning the stored reference for admins', async () => {
    findOneBook.mockResolvedValue(
      bookRow({
        published: true,
        filePath: '1730000000000-deadbeefcafe.pdf',
        originalName: 'clean-code.pdf',
        mimeType: 'application/pdf',
      }),
    );

    const info = await service.prepareDownload(7, '127.0.0.1', {
      id: 'admin-1',
      email: 'admin@ignit.local',
      name: 'Admin',
      role: 'admin',
    });

    expect(info).toEqual({
      filePath: '1730000000000-deadbeefcafe.pdf',
      originalName: 'clean-code.pdf',
      mimeType: 'application/pdf',
    });
    expect(saveEvent).not.toHaveBeenCalled();
  });

  describe('findAllPage', () => {
    it('windows the published books and counts the same filter', async () => {
      const rows = [bookRow({ published: true })];
      const countMock = vi.fn().mockResolvedValue(12);
      countBooks.mockImplementation(countMock);
      findBooks.mockResolvedValue(rows);

      const query = plainToInstance(PaginationQueryDto, {
        offset: '2',
        limit: '4',
      });

      await expect(service.findAllPage(query, { published: true })).resolves.toEqual({
        items: rows,
        total: 12,
        offset: 2,
        limit: 4,
      });
      expect(findBooks).toHaveBeenCalledWith({
        where: { published: true },
        order: { id: 'ASC' },
        skip: 2,
        take: 4,
      });
      expect(countBooks).toHaveBeenCalledWith({ where: { published: true } });
    });
  });

  describe('updateReadingState owner status transitions', () => {
    it('promotes a queued book to reading when owner saves starting progress', async () => {
      const book = bookRow({ published: true, status: ReadingStatus.QUEUED });
      findOneBook.mockResolvedValue(book);

      await service.updateReadingState(7, { progress: { page: 1, pct: 0 } }, OWNER);

      expect(book.status).toBe(ReadingStatus.READING);
      expect(saveBook).toHaveBeenCalledWith(book);
    });

    it('marks a book as finished when owner reaches 100%', async () => {
      const book = bookRow({ published: true, status: ReadingStatus.READING });
      findOneBook.mockResolvedValue(book);

      await service.updateReadingState(7, { progress: { page: 42, pct: 100 } }, OWNER);

      expect(book.status).toBe(ReadingStatus.FINISHED);
      expect(saveBook).toHaveBeenCalledWith(book);
    });

    it('keeps a finished book as finished when re-read below 100%', async () => {
      const book = bookRow({ published: true, status: ReadingStatus.FINISHED });
      findOneBook.mockResolvedValue(book);

      await service.updateReadingState(7, { progress: { page: 5, pct: 20 } }, OWNER);

      expect(book.status).toBe(ReadingStatus.FINISHED);
      expect(saveBook).not.toHaveBeenCalled();
    });
  });
});
