import type { FindManyOptions, ObjectLiteral, Repository } from 'typeorm';
import { type PagedResult, type PaginationQueryDto } from './pagination.dto.js';

/**
 * Runs one paginated read: `skip`/`take` window over the caller's find options
 * plus a `count` of the same unpaginated filter for `total` (issue 47 S3).
 *
 * The caller is responsible for a deterministic `order` on the paginated path
 * (issue 47 S6) and for keeping the no-params path byte-identical to before
 * (issue 47 S3/S4), so this helper is only used when `query.isPaginated()`.
 */
export async function paginate<T extends ObjectLiteral>(
  repository: Repository<T>,
  query: PaginationQueryDto,
  options: FindManyOptions<T> = {},
): Promise<PagedResult<T>> {
  const offset = query.offsetValue();
  const limit = query.limitValue();
  const [items, total] = await Promise.all([
    repository.find({ ...options, skip: offset, take: limit }),
    repository.count({ where: options.where }),
  ]);
  return { items, total, offset, limit };
}
