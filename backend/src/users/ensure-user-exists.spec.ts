import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { ensureUserExists } from './ensure-user-exists.js';
import type { User } from './entities/user.entity.js';

describe('ensureUserExists', () => {
  it('caches known users per repository to skip repeated SELECT lookups', async () => {
    const findOne = vi.fn().mockResolvedValue({ id: 'user-1' });
    const save = vi.fn();
    const create = vi.fn((dto) => dto);
    const repo = { findOne, save, create } as unknown as Repository<User>;

    await ensureUserExists(repo, { id: 'user-1', email: 'reader@example.com' });
    await ensureUserExists(repo, { id: 'user-1', email: 'reader@example.com' });

    expect(findOne).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });
});
