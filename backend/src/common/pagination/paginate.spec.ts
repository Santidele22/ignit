import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { paginate } from './paginate.js';
import { PaginationQueryDto } from './pagination.dto.js';

function repositoryMock() {
  return { find: vi.fn(), count: vi.fn() };
}

describe('paginate', () => {
  it('Windows find with skip/take and counts the same filter for total (S2/S3)', async () => {
    const repository = repositoryMock();
    repository.find.mockResolvedValue([{ id: 3 }, { id: 4 }]);
    repository.count.mockResolvedValue(9);
    const query = plainToInstance(PaginationQueryDto, { offset: '2', limit: '2' });

    const page = await paginate(
      repository as never,
      query,
      { order: { id: 'ASC' }, where: {} },
    );

    expect(page).toEqual({ items: [{ id: 3 }, { id: 4 }], total: 9, offset: 2, limit: 2 });
    expect(repository.find).toHaveBeenCalledWith({ where: {}, order: { id: 'ASC' }, skip: 2, take: 2 });
    expect(repository.count).toHaveBeenCalledWith({ where: {} });
  });

  it('defaults offset/limit when only one of the params is present (S2 defaults)', async () => {
    const repository = repositoryMock();
    repository.find.mockResolvedValue([]);
    repository.count.mockResolvedValue(0);
    const query = plainToInstance(PaginationQueryDto, { limit: '4' });

    const page = await paginate(repository as never, query);

    expect(repository.find).toHaveBeenCalledWith({ skip: 0, take: 4 });
    expect(repository.count).toHaveBeenCalledWith({ where: undefined });
    expect(page).toEqual({ items: [], total: 0, offset: 0, limit: 4 });
  });
});
