import type { RouteSessionUser } from '../../auth/guards/session-reader.js';
import type { Book } from '../entities/book.entity.js';
import { isAdminUser, isBookOwner } from '../lib/book-access.js';

export type PresentedBook = (Book | Omit<Book, 'ownerId'>) & { isOwner: boolean };

/**
 * Strips `ownerId` for callers who neither own the book nor hold the `admin`
 * role, while tagging `isOwner` so the UI knows when to show edit/manage links.
 */
export function presentBook(
  book: Book,
  user: RouteSessionUser | null | undefined,
): PresentedBook {
  const owner = isBookOwner(book, user);
  const copy = Object.assign({}, book) as Book;
  if (owner || isAdminUser(user)) {
    return Object.assign(copy, { isOwner: owner });
  }
  const { ownerId: _ownerId, ...publicBook } = copy;
  return Object.assign(publicBook, { isOwner: false });
}
