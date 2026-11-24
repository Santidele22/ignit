import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { paginate } from '../../common/pagination/paginate.js';
import type { PagedResult } from '../../common/pagination/pagination.dto.js';
import { Book } from '../entities/book.entity.js';
import { findBookOrFail } from '../lib/book-lookup.js';
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
}
