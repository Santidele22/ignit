import type { Repository } from 'typeorm';
import type { User } from './entities/user.entity.js';

export type SessionUserIdentity = {
  id: string;
  email?: unknown;
  name?: unknown;
  role?: string | string[] | null;
};

const MAX_KNOWN_USERS_PER_REPO = 2_000;
const knownUsersByRepo = new WeakMap<Repository<User>, Set<string>>();

function getKnownUsers(usersRepository: Repository<User>): Set<string> {
  let set = knownUsersByRepo.get(usersRepository);
  if (!set) {
    set = new Set<string>();
    knownUsersByRepo.set(usersRepository, set);
  }
  return set;
}

function rememberKnownUser(knownUsers: Set<string>, userId: string): void {
  if (knownUsers.size >= MAX_KNOWN_USERS_PER_REPO) {
    knownUsers.clear();
  }
  knownUsers.add(userId);
}

/**
 * Ensures the authenticated user has a matching row in TypeORM's `user` table
 * before inserting `Book` or `ReadingState` rows with foreign keys on `user.id`.
 * Needed because Neon Auth and dev auth manage identity outside TypeORM's rows.
 */
export async function ensureUserExists(
  usersRepository: Repository<User>,
  sessionUser: SessionUserIdentity,
): Promise<void> {
  const knownUsers = getKnownUsers(usersRepository);
  if (knownUsers.has(sessionUser.id)) {
    return;
  }

  const existing = await usersRepository.findOne({ where: { id: sessionUser.id } });
  if (existing) {
    rememberKnownUser(knownUsers, sessionUser.id);
    return;
  }

  const normalizedEmail =
    typeof sessionUser.email === 'string' && sessionUser.email.trim().length > 0
      ? sessionUser.email.trim().toLowerCase()
      : `${sessionUser.id}@ignit.local`;
  const displayName =
    typeof sessionUser.name === 'string' && sessionUser.name.trim().length > 0
      ? sessionUser.name.trim()
      : normalizedEmail;
  const normalizedRole = Array.isArray(sessionUser.role)
    ? sessionUser.role.join(',')
    : (sessionUser.role ?? 'user');

  try {
    await usersRepository.save(
      usersRepository.create({
        id: sessionUser.id,
        name: displayName,
        email: normalizedEmail,
        emailVerified: false,
        role: normalizedRole,
      }),
    );
    rememberKnownUser(knownUsers, sessionUser.id);
  } catch (error) {
    // Concurrent first request may have created the row between findOne and save.
    const raced = await usersRepository.findOne({ where: { id: sessionUser.id } });
    if (!raced) {
      throw error;
    }
    rememberKnownUser(knownUsers, sessionUser.id);
  }
}
