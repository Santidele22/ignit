import type { BookKind } from '../common/enums/book-kind.enum.js';
import type { ReadingStatus } from '../common/enums/reading-status.enum.js';
import type { ContentTier } from '../books/igb/igb1.types.js';

export interface SyncPushBookPayload {
  title?: string;
  author?: string;
  description?: string;
  kind?: BookKind;
  status?: ReadingStatus;
  contentHash?: string;
  contentTier?: ContentTier;
  igbSize?: number;
}

export interface SyncPushReadingStatePayload {
  page?: number;
  pct?: number;
  chunkId?: string | null;
  marksJson?: string;
  wordsJson?: string;
  status?: ReadingStatus;
}

export type SyncPushItem =
  | {
      clientOpId: string;
      entityType: 'book';
      op: 'upsert' | 'delete';
      bookId?: number;
      clientBookId?: string;
      updatedAt: number;
      payload?: SyncPushBookPayload;
    }
  | {
      clientOpId: string;
      entityType: 'reading_state';
      op: 'upsert';
      bookId: number;
      updatedAt: number;
      payload: SyncPushReadingStatePayload;
    };

export interface SyncPushAck {
  clientOpId: string;
  status: 'applied' | 'ignored_stale' | 'rejected';
  remoteId?: number;
  igbKey?: string;
  uploadUrl?: string | null;
  reason?: string;
}

export interface SyncPushResponse {
  serverTime: number;
  acked: SyncPushAck[];
}

export interface SyncPulledBook {
  id: number;
  title: string;
  author: string;
  kind: BookKind;
  status: ReadingStatus;
  contentTier: ContentTier;
  contentHash: string | null;
  igbPath: string | null;
  igbSize: number | null;
  igbDownloadUrl: string | null;
  updatedAt: number;
  deletedAt: number | null;
}

export interface SyncPulledReadingState {
  bookId: number;
  status: ReadingStatus;
  progressJson: string | null;
  marksJson: string | null;
  wordsJson: string | null;
  updatedAt: number;
}

export interface SyncPullResponse {
  serverTime: number;
  books: SyncPulledBook[];
  readingStates: SyncPulledReadingState[];
}
