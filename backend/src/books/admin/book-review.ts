import { BadRequestException } from '@nestjs/common';
import type { AiSafety, AiStatus } from '../ai/ai-analysis.types.js';
import type { BookKind } from '../../common/enums/book-kind.enum.js';
import {
  REVIEW_STATUS_PENDING,
  type Book,
  type BookReviewStatus,
} from '../entities/book.entity.js';
import { REVIEW_DECISIONS, type ReviewBookDto } from './dto/review-book.dto.js';

/** Message of the `400` a decision outside `approved`/`rejected` gets. */
export const INVALID_REVIEW_DECISION_MESSAGE =
  'La decisión de revisión debe ser "approved" o "rejected"';

/**
 * Applies one admin decision to the loaded row (S4): the state, the reviewer,
 * the timestamp and the optional note are always written together, so the
 * queue can never show a decision without its author.
 *
 * Publishing is only ever flipped by the explicit `publish` flag on approval;
 * a rejection always unpublishes, because a rejected PDF must not stay
 * reachable from the landing.
 */
export function applyReviewDecision(
  book: Book,
  dto: ReviewBookDto,
  reviewerId: string,
  now: Date = new Date(),
): Book {
  if (!REVIEW_DECISIONS.includes(dto.decision)) {
    throw new BadRequestException(INVALID_REVIEW_DECISION_MESSAGE);
  }

  const note = dto.note?.trim();

  book.reviewStatus = dto.decision;
  book.reviewNote = note && note.length > 0 ? note : null;
  book.reviewedBy = reviewerId;
  book.reviewedAt = now;

  if (dto.decision === 'rejected') {
    book.published = false;
  } else if (dto.publish === true) {
    book.published = true;
  }

  return book;
}

/** What the admin dashboard needs about one book, and nothing else. */
export type AdminBookView = {
  id: number;
  title: string;
  author: string;
  kind: BookKind;
  ownerId: string;
  ownerEmail: string | null;
  fileSize: string | null;
  filePages: number | null;
  createdAt: Date;
  published: boolean;
  reviewStatus: BookReviewStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  aiSafety: AiSafety | null;
  aiQuality: number | null;
  aiNotes: string | null;
  aiStatus: AiStatus | null;
};

/**
 * Projects a book (optionally loaded with its `owner` relation) into the admin
 * list/decision payload. Missing columns fall back to their documented
 * defaults so an old row never answers `undefined`.
 */
export function presentAdminBook(book: Book): AdminBookView {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    kind: book.kind,
    ownerId: book.ownerId,
    ownerEmail: book.owner?.email ?? null,
    fileSize: book.fileSize ?? null,
    filePages: book.filePages ?? null,
    createdAt: book.createdAt,
    published: book.published === true,
    reviewStatus: book.reviewStatus ?? REVIEW_STATUS_PENDING,
    reviewNote: book.reviewNote ?? null,
    reviewedBy: book.reviewedBy ?? null,
    reviewedAt: book.reviewedAt ?? null,
    aiSafety: book.aiSafety ?? null,
    aiQuality: book.aiQuality ?? null,
    aiNotes: book.aiNotes ?? null,
    aiStatus: book.aiStatus ?? null,
  };
}
