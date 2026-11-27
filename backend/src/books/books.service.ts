import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { FindOptionsWhere, Repository } from 'typeorm';
import type { RouteSessionUser } from '../auth/guards/session-reader.js';
import { ReadingStatus } from '../common/enums/reading-status.enum.js';
import { paginate } from '../common/pagination/paginate.js';
import type { PagedResult, PaginationQueryDto } from '../common/pagination/pagination.dto.js';
import { ensureUserExists, type SessionUserIdentity } from '../users/ensure-user-exists.js';
import { User } from '../users/entities/user.entity.js';
import type { CreateBookDto } from './dto/create-book.dto.js';
import type { BookMetricEvent } from './dto/record-book-metric.dto.js';
import type { UpdateBookDto } from './dto/update-book.dto.js';
import type { UpdateReadingStateDto } from './dto/update-reading-state.dto.js';
import { Book, REVIEW_STATUS_PENDING } from './entities/book.entity.js';
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
  ADMIN_APPROVAL_REQUIRED_MESSAGE,
  isOpenLicense,
  OPEN_LICENSE_REQUIRED_MESSAGE,
} from './lib/open-licenses.js';
import { downloadDescriptor } from './lib/book-download.js';
import { attachBookFile, type UploadedPdf } from './lib/book-file.js';
import {
  DEMO_FEATURED_POOL_LIMIT,
  pickDemoFeaturedBookId,
} from './lib/demo-featured.js';
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

  createForUser(
    dto: CreateBookDto,
    owner: SessionUserIdentity & Partial<Pick<RouteSessionUser, 'role'>>,
  ): Promise<Book> {
    return createBookRow(this.booksRepository, this.usersRepository, dto, owner);
  }

  async updateForUser(
    id: number,
    dto: UpdateBookDto,
    user?: RouteSessionUser | null,
  ): Promise<Book> {
    const book = await this.findOne(id);
    assertCanManageBook(book, user);
    const admin = isAdminUser(user);

    if (dto.published === true && !admin) {
      if (book.reviewStatus === 'rejected') {
        throw new ForbiddenException(
          'Este libro fue retirado por administración y solo un administrador puede volver a publicarlo',
        );
      }
      if (book.published !== true) {
        throw new ForbiddenException(ADMIN_APPROVAL_REQUIRED_MESSAGE);
      }
    }

    const nextPublished = dto.published !== undefined ? dto.published : book.published;
    const nextLicense = dto.license !== undefined ? dto.license : book.license;
    if (nextPublished === true && !isOpenLicense(nextLicense)) {
      throw new BadRequestException(OPEN_LICENSE_REQUIRED_MESSAGE);
    }

    if (admin && dto.published === true && book.reviewStatus !== 'approved') {
      book.reviewStatus = 'approved';
      book.reviewedBy = user?.id ?? null;
      book.reviewedAt = new Date();
    }

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
    options: { publishRequested?: boolean } = {},
  ): Promise<Book> {
    const book = await this.findOne(id);
    assertCanManageBook(book, user);
    // Prevent post-approval PDF bait-and-switch: replacing the PDF as a non-admin
    // returns the book to private pending review until an admin re-approves it.
    if (!isAdminUser(user) && (book.published === true || book.reviewStatus === 'approved')) {
      book.published = false;
      book.reviewStatus = REVIEW_STATUS_PENDING;
    }
    return attachBookFile(this.booksRepository, this.bookStorage, book, file, options);
  }

  async getReading(
    id: number,
    user?: RouteSessionUser | null,
  ): Promise<BookReadingDocument> {
    if (!user) {
      // Anonymous visitors may read exactly the rotating demo showcase; every
      // other reading doc requires an authenticated session (401).
      const featuredId = await this.getDemoFeaturedBookId();
      if (featuredId !== id) {
        throw new UnauthorizedException(
          'Ingresá con tu cuenta para leer este libro. Sólo la muestra destacada (demo) es de lectura libre.',
        );
      }
    }
    const book = await this.findOne(id);
    assertCanReadBook(book, user);
    const filePath = requireStoredFile(book);

    return resolveReadingDocument(id, filePath, this.bookStorage, book);
  }

  /**
   * Id of the currently rotating demo showcase book among published+approved
   * titles, or `null` when the public shelf is empty. Exported for web SSR so
   * backend and landing always agree on which book is the demo.
   */
  async getDemoFeaturedBookId(): Promise<number | null> {
    const rows = await this.booksRepository.find({
      where: { published: true, reviewStatus: 'approved' } as FindOptionsWhere<Book>,
      select: { id: true },
      order: { id: 'ASC' },
      take: DEMO_FEATURED_POOL_LIMIT,
    });
    return pickDemoFeaturedBookId(rows.map((row) => row.id));
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
    _ip: string,
    user?: RouteSessionUser | null,
  ): Promise<{ filePath: string; originalName: string; mimeType: string }> {
    if (!isAdminUser(user)) {
      throw new ForbiddenException(
        'La descarga directa del archivo fuente está restringida a administradores',
      );
    }
    const book = await this.findOne(id);
    const filePath = requireStoredFile(book);

    return downloadDescriptor(book, filePath);
  }

  async recordMetric(
    id: number,
    event: BookMetricEvent,
    user?: RouteSessionUser | null,
  ): Promise<{ ok: true }> {
    // Demo showcase reads are anonymous and must persist nothing (S2):
    // metric counters count authenticated readers only.
    requireSessionUser(user);
    const book = await this.findOne(id);
    assertCanReadBook(book, user);

    const columnMap: Record<
      BookMetricEvent,
      'readsStartedCount' | 'offlineDownloadsCount' | 'ctaClicksCount'
    > = {
      read_started: 'readsStartedCount',
      offline_download: 'offlineDownloadsCount',
      cta_click: 'ctaClicksCount',
    };

    await this.booksRepository.increment({ id: book.id }, columnMap[event], 1);
    return { ok: true };
  }
}
