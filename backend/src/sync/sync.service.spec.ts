import { describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import type { Book } from '../books/entities/book.entity.js';
import type { ReadingState } from '../books/entities/reading-state.entity.js';
import type { BookStorage } from '../books/storage/book-storage.js';
import { BookKind } from '../common/enums/book-kind.enum.js';
import { ReadingStatus } from '../common/enums/reading-status.enum.js';
import { SyncService } from './sync.service.js';

describe('SyncService multi-device delta sync (S5)', () => {
  function setup() {
    const books: Book[] = [];
    const states: ReadingState[] = [];
    let nextBookId = 100;
    let nextStateId = 1;

    const booksRepository = {
      create: vi.fn((partial: Partial<Book>) => ({ ...partial }) as Book),
      save: vi.fn(async (b: Book) => {
        if (!b.id) {
          b.id = nextBookId++;
          b.createdAt = new Date();
          b.updatedAt = new Date();
          books.push(b);
        } else {
          const idx = books.findIndex((x) => x.id === b.id);
          b.updatedAt = b.updatedAt ?? new Date();
          if (idx >= 0) books[idx] = b;
          else books.push(b);
        }
        return b;
      }),
      find: vi.fn(async ({ where }: { where: { ownerId: string } }) =>
        books.filter((b) => b.ownerId === where.ownerId),
      ),
      findOne: vi.fn(async ({ where }: { where: { id: number } }) =>
        books.find((b) => b.id === where.id) ?? null,
      ),
    } as unknown as Repository<Book>;

    const readingStateRepository = {
      create: vi.fn((partial: Partial<ReadingState>) => ({ ...partial }) as ReadingState),
      save: vi.fn(async (s: ReadingState) => {
        if (!s.id) {
          s.id = nextStateId++;
          states.push(s);
        } else {
          const idx = states.findIndex((x) => x.id === s.id);
          if (idx >= 0) states[idx] = s;
        }
        return s;
      }),
      find: vi.fn(async ({ where }: { where: { userId: string } }) =>
        states.filter((s) => s.userId === where.userId),
      ),
      findOne: vi.fn(async ({ where }: { where: { userId: string; bookId: number } }) =>
        states.find((s) => s.userId === where.userId && s.bookId === where.bookId) ?? null,
      ),
    } as unknown as Repository<ReadingState>;

    const bookStorage = {
      strategy: 's3',
      persist: vi.fn(),
      remove: vi.fn(),
      resolveDownload: vi.fn(async (key: string) => ({
        strategy: 's3' as const,
        url: `https://r2.example.com/get/${key}?sig=1`,
      })),
      resolveUpload: vi.fn(async (key: string) => `https://r2.example.com/put/${key}?sig=1`),
    } as unknown as BookStorage;

    const service = new SyncService(booksRepository, readingStateRepository, bookStorage);
    return { service, books, states };
  }

  it('syncs a private Tier 2 book from Device A to Device B with presigned upload/download URLs', async () => {
    const { service } = setup();

    // Device A creates a private book offline and pushes
    const pushRes = await service.push('user-1', [
      {
        clientOpId: 'op-1',
        entityType: 'book',
        op: 'upsert',
        clientBookId: 'local-uuid-1',
        updatedAt: 1_700_000_000_000,
        payload: {
          title: 'Rayuela',
          author: 'Cortázar',
          kind: BookKind.FICCION,
          status: ReadingStatus.READING,
          contentHash: 'deadbeef',
          igbSize: 140_000,
        },
      },
    ]);

    expect(pushRes.acked[0]).toMatchObject({
      clientOpId: 'op-1',
      status: 'applied',
      remoteId: 100,
      igbKey: 'books/private/user-1/100.igb',
      uploadUrl: 'https://r2.example.com/put/books/private/user-1/100.igb?sig=1',
    });

    // Device B pulls since 0 and gets the book + presigned download URL
    const pullRes = await service.pull('user-1', 0);
    expect(pullRes.books).toHaveLength(1);
    expect(pullRes.books[0]).toMatchObject({
      id: 100,
      title: 'Rayuela',
      contentTier: 'private_user',
      igbPath: 'books/private/user-1/100.igb',
      igbDownloadUrl: 'https://r2.example.com/get/books/private/user-1/100.igb?sig=1',
    });
  });

  it('resolves concurrent reading progress with LWW and propagates book deletion tombstones', async () => {
    const { service, books } = setup();

    await service.push('user-1', [
      {
        clientOpId: 'op-create',
        entityType: 'book',
        op: 'upsert',
        updatedAt: 1000,
        payload: { title: 'Libro', author: 'Autor' },
      },
    ]);

    // Device B pushes newer progress (t=5000)
    const newer = await service.push('user-1', [
      {
        clientOpId: 'op-b',
        entityType: 'reading_state',
        op: 'upsert',
        bookId: 100,
        updatedAt: 5000,
        payload: { page: 80, pct: 0.8 },
      },
    ]);
    expect(newer.acked[0].status).toBe('applied');

    // Device A comes online later with older offline progress (t=3000) -> ignored_stale
    const stale = await service.push('user-1', [
      {
        clientOpId: 'op-a',
        entityType: 'reading_state',
        op: 'upsert',
        bookId: 100,
        updatedAt: 3000,
        payload: { page: 25, pct: 0.25 },
      },
    ]);
    expect(stale.acked[0].status).toBe('ignored_stale');

    // Delete book at t=9000 (make sure existing updatedAt <= 9000)
    books[0].updatedAt = new Date(2000);
    const del = await service.push('user-1', [
      {
        clientOpId: 'op-del',
        entityType: 'book',
        op: 'delete',
        bookId: 100,
        updatedAt: 9000,
      },
    ]);
    expect(del.acked[0].status).toBe('applied');

    const pullAfterDelete = await service.pull('user-1', 1000);
    expect(pullAfterDelete.books[0].deletedAt).toBe(9000);
  });
});
