import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { FindOptionsWhere, Repository } from 'typeorm';
import type { RouteSessionUser } from '../auth/guards/session-reader.js';
import { ReadingStatus } from '../common/enums/reading-status.enum.js';
import { paginate } from '../common/pagination/paginate.js';
import type { PagedResult, PaginationQueryDto } from '../common/pagination/pagination.dto.js';
import { ensureUserExists, type SessionUserIdentity } from '../users/ensure-user-exists.js';
import { User } from '../users/entities/user.entity.js';
import type { CreateBookDto } from './dto/create-book.dto.js';
import type { UpdateBookDto } from './dto/update-book.dto.js';
import type { UpdateReadingStateDto } from './dto/update-reading-state.dto.js';
import { Book } from './entities/book.entity.js';
import { DownloadEvent } from './entities/download-event.entity.js';
import { ReadingState } from './entities/reading-state.entity.js';
import {
  assertCanManageBook,
  assertCanReadBook,
  isAdminUser,
  isBookOwner,
  requireSessionUser,
} from './lib/book-access.js';
import { createBookRow, removeBookRow, updateBookRow } from './lib/book-columns.js';
import {
  assertDownloadQuota,
  downloadDescriptor,
  recordDownload,
} from './lib/book-download.js';
import { attachBookFile, type UploadedPdf } from './lib/book-file.js';
import { findBookOrFail, requireStoredFile } from './lib/book-lookup.js';
import { resolveReadingDocument } from './lib/book-reading.js';
import {
  mergeReadingState,
  persistUserReadingState,
  readUserReadingState,
  readingStatusAfter,
  rowToReadingState,
} from './lib/book-reading-state.js';
import type {
  BookReadingDocument,
  BookReadingState,
} from './reading/book-reading.extractor.js';
import { BOOK_STORAGE } from './storage/book-storage.js';
import type { BookStorage } from './storage/book-storage.js';

@Injectable()
export class BooksService {
  constructor(
    @InjectRepository(Book)
    private readonly booksRepository: Repository<Book>,
    @InjectRepository(DownloadEvent)
    private readonly downloadEventsRepository: Repository<DownloadEvent>,
    @InjectRepository(ReadingState)
    private readonly readingStatesRepository: Repository<ReadingState>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @Inject(BOOK_STORAGE)
    private readonly bookStorage: BookStorage,
  ) {}

  findAll(where?: FindOptionsWhere<Book>): Promise<Book[]> {
    return this.booksRepository.find({
      ...(where ? { where } : {}),
      order: { id: 'ASC' },
    });
  }

  findAllPage(
    query: PaginationQueryDto,
    where?: FindOptionsWhere<Book>,
  ): Promise<PagedResult<Book>> {
    return paginate(this.booksRepository, query, {
      where,
      order: { id: 'ASC' },
    });
  }

  findOne(id: number): Promise<Book> {
    return findBookOrFail(this.booksRepository, id);
  }

  async findOneForReader(
    id: number,
    user?: RouteSessionUser | null,
  ): Promise<Book> {
    const book = await this.findOne(id);
    assertCanReadBook(book, user);
    return book;
  }

  createForUser(dto: CreateBookDto, owner: SessionUserIdentity): Promise<Book> {
    return createBookRow(this.booksRepository, this.usersRepository, dto, owner);
  }

  async updateForUser(
    id: number,
    dto: UpdateBookDto,
    user?: RouteSessionUser | null,
  ): Promise<Book> {
    const book = await this.findOne(id);
    assertCanManageBook(book, user);
    return updateBookRow(this.booksRepository, book, dto);
  }

  async removeForUser(id: number, user?: RouteSessionUser | null): Promise<void> {
    const book = await this.findOne(id);
    assertCanManageBook(book, user);
    await removeBookRow(
      this.booksRepository,
      this.readingStatesRepository,
      this.bookStorage,
      book,
    );
  }

  async attachFileForUser(
    id: number,
    file: UploadedPdf,
    user?: RouteSessionUser | null,
  ): Promise<Book> {
    const book = await this.findOne(id);
    assertCanManageBook(book, user);
    return attachBookFile(this.booksRepository, this.bookStorage, book, file);
  }

  async getReading(
    id: number,
    user?: RouteSessionUser | null,
  ): Promise<BookReadingDocument> {
    const book = await this.findOne(id);
    assertCanReadBook(book, user);
    const filePath = requireStoredFile(book);

    return resolveReadingDocument(id, filePath, this.bookStorage);
  }

  async getReadingState(
    id: number,
    user?: RouteSessionUser | null,
  ): Promise<BookReadingState> {
    const book = await this.findOne(id);
    assertCanReadBook(book, user);
    const sessionUser = requireSessionUser(user);

    return readUserReadingState(this.readingStatesRepository, id, sessionUser.id);
  }

  async updateReadingState(
    id: number,
    dto: UpdateReadingStateDto,
    user?: RouteSessionUser | null,
  ): Promise<BookReadingState> {
    const book = await this.findOne(id);
    assertCanReadBook(book, user);
    const sessionUser = requireSessionUser(user);

    await ensureUserExists(this.usersRepository, sessionUser);

    const existingRow = await this.readingStatesRepository.findOne({
      where: { bookId: id, userId: sessionUser.id },
    });
    const current = rowToReadingState(id, existingRow);
    const next = mergeReadingState(id, dto, current);
    const currentStatus =
      existingRow?.status ??
      (isBookOwner(book, sessionUser) ? book.status : ReadingStatus.QUEUED);
    const nextStatus = readingStatusAfter(currentStatus, dto);

    await persistUserReadingState(
      this.readingStatesRepository,
      id,
      sessionUser.id,
      next,
      nextStatus,
      existingRow,
    );
    next.status = nextStatus;

    if (isBookOwner(book, sessionUser)) {
      const ownerNextStatus = readingStatusAfter(book.status, dto);
      if (ownerNextStatus !== book.status) {
        book.status = ownerNextStatus;
        await this.booksRepository.save(book);
      }
    }

    return next;
  }

  async prepareDownload(
    id: number,
    ip: string,
    user?: RouteSessionUser | null,
  ): Promise<{ filePath: string; originalName: string; mimeType: string }> {
    const book = await this.findOne(id);
    assertCanReadBook(book, user);
    const filePath = requireStoredFile(book);

    if (!isBookOwner(book, user) && !isAdminUser(user)) {
      await assertDownloadQuota(this.downloadEventsRepository, ip);
      await recordDownload(this.downloadEventsRepository, ip, id);
    }

    return downloadDescriptor(book, filePath);
  }
}
