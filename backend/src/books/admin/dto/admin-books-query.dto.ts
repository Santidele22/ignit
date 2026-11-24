import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { MAX_LIMIT, PaginationQueryDto } from '../../../common/pagination/pagination.dto.js';
import {
  BOOK_REVIEW_STATUSES,
  type BookReviewStatus,
} from '../../entities/book.entity.js';

/**
 * Query of `GET /admin/books`: the shared pagination window expressed as a
 * 1-based `page`/`pageSize` pair (the admin dashboard thinks in pages) plus the
 * review filter. Unknown review values are rejected with `400` instead of
 * silently listing everything.
 */
export class AdminBooksQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: BOOK_REVIEW_STATUSES,
    enumName: 'BookReviewStatus',
    description: 'Only list books in this review state (omit for every state)',
  })
  @IsOptional()
  @IsIn([...BOOK_REVIEW_STATUSES])
  review?: BookReviewStatus;

  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1, description: '1-based page number' })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: MAX_LIMIT,
    default: 20,
    description: `Page size (clamped to 1..${MAX_LIMIT})`,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  pageSize?: number;

  /** The admin queue is always paginated; there is no unpaginated variant. */
  override isPaginated(): boolean {
    return true;
  }

  /** `pageSize` wins over `limit`; both clamp to the shared window. */
  override limitValue(): number {
    if (this.pageSize === undefined) {
      return super.limitValue();
    }

    return Math.min(Math.max(Math.trunc(this.pageSize), 1), MAX_LIMIT);
  }

  /** `page` wins over `offset`; both are non-negative. */
  override offsetValue(): number {
    if (this.page === undefined) {
      return super.offsetValue();
    }

    return Math.max(0, Math.trunc(this.page) - 1) * this.limitValue();
  }
}
