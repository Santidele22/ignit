/**
 * Session shape the `/admin` gate inspects. `role` is a plain string in Better
 * Auth, but the backend also accepts a comma list or an array, so the gate
 * accepts every representation the API can produce.
 */
export type AdminSessionUser = { role?: string | string[] | null } | null | undefined;

/**
 * Admin predicate of the dashboard gate (S5).
 *
 * Mirrors `isAdminUser` in `backend/src/books/lib/book-access.ts`: `'admin'`,
 * `'user,admin'` (trimmed) and `['user', 'admin']` are admins; a missing role,
 * a `null` role, a `null`/`undefined` user or any other role is not. The match
 * is exact per entry — never a substring — so `'administrator'` stays a plain
 * reader.
 */
export function isAdminSession(user: AdminSessionUser): boolean {
	const role = user?.role;
	if (role === undefined || role === null) {
		return false;
	}

	const roles = Array.isArray(role) ? role : role.split(',');
	return roles.some((entry) => typeof entry === 'string' && entry.trim() === 'admin');
}
