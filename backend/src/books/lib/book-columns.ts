import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { RouteSessionUser } from '../../auth/guards/session-reader.js';
import { ensureUserExists, type SessionUserIdentity } from '../../users/ensure-user-exists.js';
import type { User } from '../../users/entities/user.entity.js';
import type { CreateBookDto } from '../dto/create-book.dto.js';
import type { UpdateBookDto } from '../dto/update-book.dto.js';
import type { Book } from '../entities/book.entity.js';
import { REVIEW_STATUS_PENDING } from '../entities/book.entity.js';
import type { ReadingState } from '../entities/reading-state.entity.js';
import { removeBookReadingArtifacts } from '../reading/book-reading.extractor.js';
import type { BookStorage } from '../storage/book-storage.js';
import { isAdminUser } from './book-access.js';
import { removeBookFirewallReport } from './book-firewall-report.js';
import { readingJsonKey, readingStateKey } from './book-sidecar-keys.js';
import { isOpenLicense, OPEN_LICENSE_REQUIRED_MESSAGE } from './open-licenses.js';

const NULLABLE_EDITORIAL_KEYS = [
  'publisher',
  'translator',
  'illustrator',
  'isbn',
  'license',
  'ctaLabel',
  'ctaUrl',
] as const;

function normalizeEditorialFields<T extends Partial<CreateBookDto>>(dto: T): T {
  const normalized: Record<string, unknown> = { ...dto };
  for (const key of NULLABLE_EDITORIAL_KEYS) {
    if (key in normalized) {
      const value = normalized[key];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        normalized[key] = trimmed.length > 0 ? trimmed : null;
      } else if (value === null) {
        normalized[key] = null;
      }
    }
  }
  return normalized as T;
}

/**
 * Creates a book owned strictly by the authenticated user, ensuring the
 * shadow `user` row exists first when external/dev auth is active.
 */
export async function createBookRow(
  booksRepository: Repository<Book>,
  usersRepository: Repository<User>,
  dto: CreateBookDto,
  owner: SessionUserIdentity & Partial<Pick<RouteSessionUser, 'role'>>,
): Promise<Book> {
  const normalized = normalizeEditorialFields(dto);
  if (normalized.published === true && !isOpenLicense(normalized.license)) {
    throw new BadRequestException(OPEN_LICENSE_REQUIRED_MESSAGE);
  }

  await ensureUserExists(usersRepository, owner);

  if (typeof booksRepository.find === 'function') {
    const existing = await booksRepository.find({ where: { ownerId: owner.id } });
    if (Array.isArray(existing)) {
      const normTitle = dto.title.trim().toLowerCase();
      const normAuthor = dto.author.trim().toLowerCase();
      const duplicate = existing.some(
        (row) =>
          row.title.trim().toLowerCase() === normTitle &&
          row.author.trim().toLowerCase() === normAuthor,
      );
      if (duplicate) {
        throw new ConflictException('Ya tenés un libro cargado con el mismo título y autor.');
      }
    }
  }

  const admin = isAdminUser({ role: owner.role });
  const book = booksRepository.create(normalized);
  book.ownerId = owner.id;
  if (admin && normalized.published === true) {
    book.published = true;
    book.reviewStatus = 'approved';
    book.reviewedBy = owner.id;
    book.reviewedAt = new Date();
  } else {
    // Non-admin uploads always stay private (`published = false`) and pending
    // until an administrator reviews and approves their open license.
    book.published = false;
    book.reviewStatus = REVIEW_STATUS_PENDING;
  }

  return booksRepository.save(book);
}

/** Merges the editable columns onto the loaded row and persists it. */
export async function updateBookRow(
  booksRepository: Repository<Book>,
  book: Book,
  dto: UpdateBookDto,
): Promise<Book> {
  booksRepository.merge(book, normalizeEditorialFields(dto));

  return booksRepository.save(book);
}

/**
 * Removes the book together with its PDF, reading artifacts, and any stored
 * per-user reading states.
 */
export async function removeBookRow(
  booksRepository: Repository<Book>,
  readingStatesRepository: Repository<ReadingState>,
  bookStorage: BookStorage,
  book: Book,
): Promise<void> {
  await bookStorage.remove(book.filePath);
  await bookStorage.remove(readingJsonKey(book.id)).catch(() => undefined);
  await bookStorage.remove(readingStateKey(book.id)).catch(() => undefined);
  await removeBookFirewallReport(book.id, bookStorage).catch(() => undefined);
  await removeBookReadingArtifacts(book.id);
  await readingStatesRepository.delete({ bookId: book.id }).catch(() => undefined);
  await booksRepository.delete(book.id);
}
