import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { RouteSessionUser } from '../../auth/guards/session-reader.js';
import type { Book } from '../entities/book.entity.js';

export type AuthenticatedSessionUser = RouteSessionUser & { id: string };

/**
 * Checks whether the session carries the `admin` role across string, array,
 * or Better Auth's comma-separated role representation.
 */
export function isAdminUser(user: RouteSessionUser | null | undefined): boolean {
  if (!user || user.role === undefined || user.role === null) {
    return false;
  }
  const roles = Array.isArray(user.role)
    ? user.role
    : user.role.split(',').map((part) => part.trim());
  return roles.includes('admin');
}

export function isBookOwner(
  book: Pick<Book, 'ownerId'>,
  user: RouteSessionUser | null | undefined,
): boolean {
  return Boolean(user?.id && book.ownerId === user.id);
}

export function canReadBook(
  book: Pick<Book, 'published' | 'ownerId'>,
  user: RouteSessionUser | null | undefined,
): boolean {
  return book.published === true || isBookOwner(book, user) || isAdminUser(user);
}

export function requireSessionUser(
  user: RouteSessionUser | null | undefined,
): AuthenticatedSessionUser {
  if (!user || typeof user.id !== 'string' || user.id.trim().length === 0) {
    throw new UnauthorizedException();
  }
  return user as AuthenticatedSessionUser;
}

/**
 * Enforces read access without leaking existence of private (`published=false`)
 * books belonging to other users (answers 404).
 */
export function assertCanReadBook(
  book: Pick<Book, 'id' | 'published' | 'ownerId'>,
  user: RouteSessionUser | null | undefined,
): void {
  if (!canReadBook(book, user)) {
    throw new NotFoundException(`Book with id ${book.id} not found`);
  }
}

/**
 * Enforces mutation ownership: non-owners receive 404 on private books (no
 * existence leak) and 403 on another user's published book.
 */
export function assertCanManageBook(
  book: Pick<Book, 'id' | 'published' | 'ownerId'>,
  user: RouteSessionUser | null | undefined,
): void {
  if (!canReadBook(book, user)) {
    throw new NotFoundException(`Book with id ${book.id} not found`);
  }
  if (!isBookOwner(book, user) && !isAdminUser(user)) {
    throw new ForbiddenException('Only the book owner can modify this book');
  }
}
