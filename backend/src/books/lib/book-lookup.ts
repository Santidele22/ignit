import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { Book } from '../entities/book.entity.js';

/**
 * Reads a book by id or answers the historical `404` message. Every service
 * path that needs an existing row goes through here, so the not-found wording
 * lives in one place.
 */
export async function findBookOrFail(
  repository: Repository<Book>,
  id: number,
): Promise<Book> {
  const book = await repository.findOne({ where: { id } });
  if (!book) {
    throw new NotFoundException(`Book with id ${id} not found`);
  }

  return book;
}

/** Public surface guard: only published books answer the reading/download routes. */
export function requirePublished(book: Book): void {
  if (!book.published) {
    throw new NotFoundException(`Book with id ${book.id} not found`);
  }
}

/** A published book may still have no uploaded PDF; that is a distinct 404. */
export function requireStoredFile(book: Book): string {
  if (!book.filePath) {
    throw new NotFoundException(`Book with id ${book.id} has no file`);
  }

  return book.filePath;
}
