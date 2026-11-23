import type { AuthSession } from '../types';

/**
 * Accepts any valid authenticated session regardless of role (`user`,
 * `authenticated`, `admin`, etc.).
 */
export function isAuthenticatedSession(value: unknown): value is AuthSession {
	if (typeof value !== 'object' || value === null || !('user' in value)) {
		return false;
	}

	const user = (value as { user?: unknown }).user;
	if (typeof user !== 'object' || user === null) {
		return false;
	}

	const candidate = user as { id?: unknown; email?: unknown };
	const hasId = typeof candidate.id === 'string' && candidate.id.trim().length > 0;
	const hasEmail = typeof candidate.email === 'string' && candidate.email.trim().length > 0;
	return hasId || hasEmail;
}
