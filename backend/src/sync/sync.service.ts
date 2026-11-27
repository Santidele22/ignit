import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Book } from '../books/entities/book.entity.js';
import { ReadingState } from '../books/entities/reading-state.entity.js';
import { IGB1_MIME_TYPE, igbObjectKey } from '../books/igb/igb1.storage.js';
import { BOOK_STORAGE, type BookStorage } from '../books/storage/book-storage.js';
import { BookKind } from '../common/enums/book-kind.enum.js';
import { ReadingStatus } from '../common/enums/reading-status.enum.js';
import type {
  SyncPullResponse,
  SyncPulledBook,
  SyncPulledReadingState,
  SyncPushAck,
  SyncPushItem,
  SyncPushResponse,
} from './sync.types.js';

@Injectable()
export class SyncService {
  constructor(
    @InjectRepository(Book)
    private readonly booksRepository: Repository<Book>,
    @InjectRepository(ReadingState)
    private readonly readingStateRepository: Repository<ReadingState>,
    @Inject(BOOK_STORAGE)
    private readonly bookStorage: BookStorage,
  ) {}

  async push(userId: string, items: SyncPushItem[]): Promise<SyncPushResponse> {
    const acked: SyncPushAck[] = [];

    for (const item of items) {
      if (item.entityType === 'book') {
        acked.push(await this.applyBookOp(userId, item));
      } else if (item.entityType === 'reading_state') {
        acked.push(await this.applyReadingStateOp(userId, item));
      }
    }

    return {
      serverTime: Date.now(),
      acked,
    };
  }

  async pull(userId: string, sinceEpochMs: number): Promise<SyncPullResponse> {
    const serverTime = Date.now();
    const allUserBooks = await this.booksRepository.find({
      where: { ownerId: userId },
    });

    const changedBooks = allUserBooks.filter((b) => {
      const updated = b.updatedAt ? b.updatedAt.getTime() : 0;
      const deleted = b.deletedAt ? b.deletedAt.getTime() : 0;
      return Math.max(updated, deleted) > sinceEpochMs;
    });

    const books: SyncPulledBook[] = await Promise.all(
      changedBooks.map(async (b) => {
        let igbDownloadUrl: string | null = null;
        if (!b.deletedAt && b.igbPath && this.bookStorage.strategy === 's3') {
          const dl = await this.bookStorage.resolveDownload(b.igbPath).catch(() => null);
          if (dl && dl.strategy === 's3') {
            igbDownloadUrl = dl.url;
          }
        }
        return {
          id: b.id,
          title: b.title,
          author: b.author,
          kind: b.kind,
          status: b.status,
          contentTier: b.contentTier ?? 'private_user',
          contentHash: b.contentHash ?? null,
          igbPath: b.igbPath ?? null,
          igbSize: b.igbSize ?? null,
          igbDownloadUrl,
          updatedAt: b.updatedAt ? b.updatedAt.getTime() : serverTime,
          deletedAt: b.deletedAt ? b.deletedAt.getTime() : null,
        };
      }),
    );

    const allUserStates = await this.readingStateRepository.find({
      where: { userId },
    });
    const readingStates: SyncPulledReadingState[] = allUserStates
      .filter((s) => (s.updatedAt ? s.updatedAt.getTime() : 0) > sinceEpochMs)
      .map((s) => ({
        bookId: s.bookId,
        status: s.status,
        progressJson: s.progressJson ?? null,
        marksJson: s.marksJson ?? null,
        wordsJson: s.wordsJson ?? null,
        updatedAt: s.updatedAt ? s.updatedAt.getTime() : serverTime,
      }));

    return {
      serverTime,
      books,
      readingStates,
    };
  }

  private async applyBookOp(
    userId: string,
    item: Extract<SyncPushItem, { entityType: 'book' }>,
  ): Promise<SyncPushAck> {
    if (item.op === 'delete') {
      if (!item.bookId) {
        return { clientOpId: item.clientOpId, status: 'rejected', reason: 'Missing bookId' };
      }
      const existing = await this.booksRepository.findOne({ where: { id: item.bookId } });
      if (!existing || existing.ownerId !== userId) {
        return { clientOpId: item.clientOpId, status: 'rejected', reason: 'Book not found' };
      }
      const currentUpdated = existing.updatedAt ? existing.updatedAt.getTime() : 0;
      if (item.updatedAt < currentUpdated) {
        return { clientOpId: item.clientOpId, status: 'ignored_stale', remoteId: existing.id };
      }
      existing.deletedAt = new Date(item.updatedAt);
      await this.booksRepository.save(existing);
      return { clientOpId: item.clientOpId, status: 'applied', remoteId: existing.id };
    }

    const payload = item.payload ?? {};
    let book: Book | null = null;
    if (item.bookId) {
      book = await this.booksRepository.findOne({ where: { id: item.bookId } });
      if (!book || book.ownerId !== userId) {
        return { clientOpId: item.clientOpId, status: 'rejected', reason: 'Book not found' };
      }
      const currentUpdated = book.updatedAt ? book.updatedAt.getTime() : 0;
      if (item.updatedAt < currentUpdated) {
        return { clientOpId: item.clientOpId, status: 'ignored_stale', remoteId: book.id };
      }
    } else {
      book = this.booksRepository.create({
        ownerId: userId,
        title: payload.title?.trim() || 'Sin título',
        author: payload.author?.trim() || 'Desconocido',
        description: payload.description ?? '',
        kind: payload.kind ?? BookKind.NO_TECNICO,
        status: payload.status ?? ReadingStatus.QUEUED,
        published: false,
        contentTier: 'private_user',
      });
    }

    if (payload.title !== undefined) book.title = payload.title;
    if (payload.author !== undefined) book.author = payload.author;
    if (payload.description !== undefined) book.description = payload.description;
    if (payload.kind !== undefined) book.kind = payload.kind;
    if (payload.status !== undefined) book.status = payload.status;
    if (payload.contentHash !== undefined) book.contentHash = payload.contentHash;
    if (payload.igbSize !== undefined) book.igbSize = payload.igbSize;

    const saved = await this.booksRepository.save(book);

    let uploadUrl: string | null = null;
    let igbKey: string | undefined;
    if ((saved.contentTier ?? 'private_user') === 'private_user') {
      igbKey = igbObjectKey('private_user', {
        bookId: saved.id,
        ownerId: userId,
        contentHash: saved.contentHash ?? '',
      });
      if (saved.igbPath !== igbKey) {
        saved.igbPath = igbKey;
        saved.filePath = igbKey;
        await this.booksRepository.save(saved);
      }
      if (typeof this.bookStorage.resolveUpload === 'function') {
        uploadUrl = await this.bookStorage.resolveUpload(igbKey, IGB1_MIME_TYPE);
      }
    }

    return {
      clientOpId: item.clientOpId,
      status: 'applied',
      remoteId: saved.id,
      igbKey,
      uploadUrl,
    };
  }

  private async applyReadingStateOp(
    userId: string,
    item: Extract<SyncPushItem, { entityType: 'reading_state' }>,
  ): Promise<SyncPushAck> {
    const existing = await this.readingStateRepository.findOne({
      where: { userId, bookId: item.bookId },
    });

    if (existing && existing.updatedAt && existing.updatedAt.getTime() > item.updatedAt) {
      return {
        clientOpId: item.clientOpId,
        status: 'ignored_stale',
        remoteId: item.bookId,
      };
    }

    const state =
      existing ??
      this.readingStateRepository.create({
        userId,
        bookId: item.bookId,
        status: ReadingStatus.READING,
      });

    if (item.payload.status !== undefined) state.status = item.payload.status;
    if (item.payload.page !== undefined || item.payload.pct !== undefined || item.payload.chunkId !== undefined) {
      state.progressJson = JSON.stringify({
        page: item.payload.page ?? 1,
        pct: item.payload.pct ?? 0,
        ...(item.payload.chunkId ? { chunkId: item.payload.chunkId } : {}),
      });
    }
    if (item.payload.marksJson !== undefined) state.marksJson = item.payload.marksJson;
    if (item.payload.wordsJson !== undefined) state.wordsJson = item.payload.wordsJson;
    state.updatedAt = new Date(item.updatedAt);

    await this.readingStateRepository.save(state);
    return {
      clientOpId: item.clientOpId,
      status: 'applied',
      remoteId: item.bookId,
    };
  }
}
