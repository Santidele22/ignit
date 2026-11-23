import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';

/** Hard cap so no query param can return a whole table unintentionally (issue 47 S2). */
export const MAX_LIMIT = 50;
/** Default page size when only one of offset/limit is provided. */
export const DEFAULT_LIMIT = 20;

/**
 * Shared offset/limit pagination query for every collection GET endpoint.
 * The global ValidationPipe coerces strings into numbers (`"4"` -> 4) and
 * rejects non-numeric values with 400, so garbage never reaches SQL; numeric
 * values outside the window are clamped by `offsetValue`/`limitValue` instead
 * of rejected, so an excessive param is sanitized, never a 500 (issue 47 S2).
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    default: 0,
    description: 'Number of items to skip; enables paginated envelope when present',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  offset?: number;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: 50,
    default: 20,
    description: 'Page size (clamped to 1..50); enables paginated envelope when present',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  limit?: number;

  /** Pagination mode is on as soon as either param is present. */
  isPaginated(): boolean {
    return this.offset !== undefined || this.limit !== undefined;
  }

  /** Effective offset: absent means the first page, negatives clamp to it. */
  offsetValue(): number {
    return Math.max(0, this.offset ?? 0);
  }

  /** Effective limit: absent means the default page size, clamped to [1, MAX_LIMIT]. */
  limitValue(): number {
    return Math.min(Math.max(this.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  }
}

/** Paginated response envelope `{ items, total, offset, limit }` only present when the caller paginates. */
export interface PagedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}
