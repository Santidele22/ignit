import { HttpException, HttpStatus } from '@nestjs/common';
import { MoreThanOrEqual, type Repository } from 'typeorm';
import type { Book } from '../entities/book.entity.js';
import type { DownloadEvent } from '../entities/download-event.entity.js';

/** Window used by the per-IP daily cap on `GET /books/:id/download`. */
const DOWNLOAD_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Shape the controller hands to the storage layer to stream or redirect. */
export type DownloadDescriptor = {
  filePath: string;
  originalName: string;
  mimeType: string;
};

/**
 * Reads the cap on every call (not at import time) so the env var can change
 * between requests, as the e2e suite expects.
 */
function dailyDownloadLimit(): number {
  return Number(process.env.BOOKS_DAILY_DOWNLOAD_LIMIT ?? 10);
}

/** Start of the rolling 24h window the counter looks back to. */
export function downloadWindowStart(now: number = Date.now()): Date {
  return new Date(now - DOWNLOAD_WINDOW_MS);
}

/**
 * Counts this IP's downloads inside the window and answers 429 once the cap is
 * reached, before anything is recorded.
 */
export async function assertDownloadQuota(
  downloadEventsRepository: Repository<DownloadEvent>,
  ip: string,
): Promise<void> {
  const count = await downloadEventsRepository.count({
    where: { ip, createdAt: MoreThanOrEqual(downloadWindowStart()) },
  });
  if (count >= dailyDownloadLimit()) {
    throw new HttpException(
      'Has superado el límite de descargas diarias',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** Records the download that is about to be served. */
export async function recordDownload(
  downloadEventsRepository: Repository<DownloadEvent>,
  ip: string,
  bookId: number,
): Promise<void> {
  await downloadEventsRepository.save(
    downloadEventsRepository.create({ ip, bookId }),
  );
}

/** Projects the stored reference into the transport-neutral download info. */
export function downloadDescriptor(book: Book, filePath: string): DownloadDescriptor {
  return {
    filePath,
    originalName: book.originalName ?? `book-${book.id}.pdf`,
    mimeType: book.mimeType ?? 'application/pdf',
  };
}
