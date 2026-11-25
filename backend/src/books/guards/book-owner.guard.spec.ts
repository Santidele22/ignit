import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { RouteSessionUser } from '../../auth/guards/session-reader.js';
import type { BooksService } from '../books.service.js';
import type { Book } from '../entities/book.entity.js';
import { BookOwnerGuard } from './book-owner.guard.js';

function contextWith(id: string | undefined, user: RouteSessionUser | null | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ params: { id }, user }),
    }),
  } as unknown as ExecutionContext;
}

describe('BookOwnerGuard', () => {
  const findOne = vi.fn();
  const guard = new BookOwnerGuard({ findOne } as unknown as BooksService);

  it('throws 404 when id param is invalid', async () => {
    await expect(guard.canActivate(contextWith('abc', { id: 'u1' }))).rejects.toThrow(NotFoundException);
    await expect(guard.canActivate(contextWith('0', { id: 'u1' }))).rejects.toThrow(NotFoundException);
  });

  it('throws 404 on a private book belonging to another user (no existence leak)', async () => {
    findOne.mockResolvedValue({ id: 9, ownerId: 'owner-1', published: false } as Book);

    await expect(
      guard.canActivate(contextWith('9', { id: 'other-user', role: 'user' })),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws 403 on a published book belonging to another user', async () => {
    findOne.mockResolvedValue({
      id: 9,
      ownerId: 'owner-1',
      published: true,
      reviewStatus: 'approved',
    } as Book);

    await expect(
      guard.canActivate(contextWith('9', { id: 'other-user', role: 'user' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows the book owner on both private and published books', async () => {
    findOne.mockResolvedValue({ id: 9, ownerId: 'owner-1', published: false } as Book);

    await expect(
      guard.canActivate(contextWith('9', { id: 'owner-1', role: 'user' })),
    ).resolves.toBe(true);
  });

  it('allows an admin user regardless of ownerId', async () => {
    findOne.mockResolvedValue({ id: 9, ownerId: 'owner-1', published: false } as Book);

    await expect(
      guard.canActivate(contextWith('9', { id: 'admin-1', role: 'admin' })),
    ).resolves.toBe(true);
  });
});
