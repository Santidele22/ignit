import type { RouteSessionUser } from '../../auth/guards/session-reader.js';
import type { Book } from '../entities/book.entity.js';
import { isAdminUser, isBookOwner } from '../lib/book-access.js';

export type PresentedBook = (WithoutModeration<Book> | WithoutModeration<Omit<Book, 'ownerId'>>) & { isOwner: boolean };

/**
 * Moderation-only columns that must never reach a public/owner payload:
 * review decisions and AI verdicts are admin-only surface (the `/admin`
 * dashboard returns them from its own DTO views, never through `presentBook`).
 */
const MODERATION_ONLY_KEYS = [
  'reviewStatus',
  'reviewNote',
  'reviewedBy',
  'reviewedAt',
  'aiSafety',
  'aiQuality',
  'aiNotes',
  'aiStatus',
] as const;

type ModerationOnlyKey = (typeof MODERATION_ONLY_KEYS)[number];

type WithoutModeration<T> = Omit<T, ModerationOnlyKey>;

function stripModerationColumns<T extends object>(book: T): WithoutModeration<T> {
  const clone = { ...book };
  for (const key of MODERATION_ONLY_KEYS) {
    delete (clone as Record<string, unknown>)[key];
  }
  return clone as WithoutModeration<T>;
}

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
    return Object.assign(stripModerationColumns(copy), { isOwner: owner });
  }
  const { ownerId: _ownerId, ...publicBook } = copy;
  return Object.assign(stripModerationColumns(publicBook), { isOwner: false });
}
