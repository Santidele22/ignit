import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { paginate } from '../../common/pagination/paginate.js';
import type { PagedResult } from '../../common/pagination/pagination.dto.js';
import { refineReadingDocument } from '../ai/ai-refiner.service.js';
import { Book } from '../entities/book.entity.js';
import { findBookOrFail } from '../lib/book-lookup.js';
import { loadBookFirewallReport } from '../lib/book-firewall-report.js';
import { readingDeterministicJsonKey, readingJsonKey } from '../lib/book-sidecar-keys.js';
import type { PdfFirewallReport } from '../pdf-firewall/pdf-firewall.types.js';
import {
  readBookDeterministicReadingJson,
  readBookReadingJson,
  writeBookDeterministicReadingJson,
  writeBookReadingJson,
} from '../reading/reading.state.js';
import type { AiRefinementSummary, BookReadingDocument } from '../reading/reading.types.js';
import { BOOK_STORAGE } from '../storage/book-storage.js';
import type { BookStorage } from '../storage/book-storage.js';
import {
  applyReviewDecision,
  presentAdminBook,
  type AdminBookView,
} from './book-review.js';
import type { AdminBooksQueryDto } from './dto/admin-books-query.dto.js';
import type { ReviewBookDto } from './dto/review-book.dto.js';

/**
 * Admin review surface (S4): the paginated upload queue and the one decision
 * endpoint. Both read the `books` table directly — there is no second copy of
 * the pipeline, the dashboard just sees the review columns.
 */
@Injectable()
export class BooksAdminService {
  constructor(
    @InjectRepository(Book)
    private readonly booksRepository: Repository<Book>,
    @Inject(BOOK_STORAGE)
    private readonly bookStorage: BookStorage,
  ) {}

  /** One page of the queue, newest rows last, with the owner email joined in. */
  async list(query: AdminBooksQueryDto): Promise<PagedResult<AdminBookView>> {
    const page = await paginate(this.booksRepository, query, {
      where: query.review ? { reviewStatus: query.review } : {},
      order: { id: 'ASC' },
      relations: { owner: true },
    });

    return { ...page, items: page.items.map(presentAdminBook) };
  }

  /** Records one admin decision on an existing book and answers its new state. */
  async review(
    id: number,
    dto: ReviewBookDto,
    reviewerId: string,
  ): Promise<AdminBookView> {
    const book = await findBookOrFail(this.booksRepository, id);
    applyReviewDecision(book, dto, reviewerId);

    return presentAdminBook(await this.booksRepository.save(book));
  }

  /**
   * Answers the stored per-tier firewall pipeline report of one upload (S3):
   * the exact evidence the deterministic firewall collected when the PDF was
   * attached, including rejected uploads whose file never survived.
   * A `404` means no report exists (pre-sidecar uploads or no file at all).
   */
  async firewall(id: number): Promise<PdfFirewallReport> {
    const book = await findBookOrFail(this.booksRepository, id);
    const report = await loadBookFirewallReport(book.id, this.bookStorage);
    if (!report) {
      throw new NotFoundException('Este libro no tiene reporte de firewall');
    }
    return report;
  }

  /**
   * Re-runs the LLM structural refiner on a book's deterministic baseline (or
   * current `reading.json`), saving the deterministic backup beforehand so the
   * admin can always revert.
   */
  async refineReading(id: number): Promise<{ bookId: number } & AiRefinementSummary> {
    const book = await findBookOrFail(this.booksRepository, id);
    const baseline =
      (await this.loadReadingSidecar(book.id, 'deterministic')) ??
      (await this.loadReadingSidecar(book.id, 'current'));
    if (!baseline) {
      throw new NotFoundException('Este libro todavía no tiene lectura extraída');
    }

    const result = await refineReadingDocument(baseline);
    if (result.summary.applied) {
      await writeBookDeterministicReadingJson(book.id, baseline).catch(() => undefined);
      await writeBookReadingJson(book.id, result.document).catch(() => undefined);
      if (this.bookStorage.putJson) {
        await this.bookStorage
          .putJson(readingDeterministicJsonKey(book.id), baseline)
          .catch(() => undefined);
        await this.bookStorage
          .putJson(readingJsonKey(book.id), result.document)
          .catch(() => undefined);
      }
    }

    return { bookId: book.id, ...result.summary };
  }

  /** Restores the deterministic `reading.json` baseline for a book. */
  async revertReadingRefinement(id: number): Promise<{ bookId: number; reverted: boolean }> {
    const book = await findBookOrFail(this.booksRepository, id);
    const baseline = await this.loadReadingSidecar(book.id, 'deterministic');
    if (!baseline) {
      throw new NotFoundException('Este libro no tiene una versión determinista guardada');
    }

    await writeBookReadingJson(book.id, baseline).catch(() => undefined);
    if (this.bookStorage.putJson) {
      await this.bookStorage.putJson(readingJsonKey(book.id), baseline).catch(() => undefined);
    }
    return { bookId: book.id, reverted: true };
  }

  private async loadReadingSidecar(
    bookId: number,
    kind: 'deterministic' | 'current',
  ): Promise<BookReadingDocument | null> {
    const local =
      kind === 'deterministic'
        ? await readBookDeterministicReadingJson(bookId)
        : await readBookReadingJson(bookId);
    if (local) return local;

    if (this.bookStorage.getJson) {
      const key =
        kind === 'deterministic'
          ? readingDeterministicJsonKey(bookId)
          : readingJsonKey(bookId);
      return await this.bookStorage.getJson<BookReadingDocument>(key).catch(() => null);
    }
    return null;
  }
}
