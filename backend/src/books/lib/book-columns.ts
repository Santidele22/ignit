import type { Repository } from 'typeorm';
import { ensureUserExists, type SessionUserIdentity } from '../../users/ensure-user-exists.js';
import type { User } from '../../users/entities/user.entity.js';
import type { CreateBookDto } from '../dto/create-book.dto.js';
import type { UpdateBookDto } from '../dto/update-book.dto.js';
import type { Book } from '../entities/book.entity.js';
import { REVIEW_STATUS_PENDING } from '../entities/book.entity.js';
import type { ReadingState } from '../entities/reading-state.entity.js';
import { removeBookReadingArtifacts } from '../reading/book-reading.extractor.js';
import type { BookStorage } from '../storage/book-storage.js';
import { readingJsonKey, readingStateKey } from './book-sidecar-keys.js';

/**
 * Creates a book owned strictly by the authenticated user, ensuring the
 * shadow `user` row exists first when external/dev auth is active.
 */
export async function createBookRow(
  booksRepository: Repository<Book>,
  usersRepository: Repository<User>,
  dto: CreateBookDto,
  owner: SessionUserIdentity,
): Promise<Book> {
  await ensureUserExists(usersRepository, owner);

  const book = booksRepository.create(dto);
  book.ownerId = owner.id;
  // Every new row starts in the admin review queue (S4); uploads keep it
  // pending until an admin decides, and the column default backfills old rows.
  book.reviewStatus = REVIEW_STATUS_PENDING;

  return booksRepository.save(book);
}

/** Merges the editable columns onto the loaded row and persists it. */
export async function updateBookRow(
  booksRepository: Repository<Book>,
  book: Book,
  dto: UpdateBookDto,
): Promise<Book> {
  booksRepository.merge(book, dto);

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
  await removeBookReadingArtifacts(book.id);
  await readingStatesRepository.delete({ bookId: book.id }).catch(() => undefined);
  await booksRepository.delete(book.id);
}
