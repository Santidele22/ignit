import { describe, expect, it } from 'vitest';
import { isAuthenticatedSession } from './userSession';

describe('isAuthenticatedSession', () => {
	it('accepts any authenticated user role (user, authenticated, admin)', () => {
		expect(isAuthenticatedSession({ user: { id: 'u1', email: 'a@ignit.app', role: 'user' } })).toBe(true);
		expect(isAuthenticatedSession({ user: { id: 'u2', email: 'b@ignit.app', role: 'authenticated' } })).toBe(true);
		expect(isAuthenticatedSession({ user: { email: 'admin@ignit.app', role: 'admin' } })).toBe(true);
	});

	it.each([
		['an empty user object', { user: {} }],
		['a missing user', { session: { id: 'session-1' } }],
		['a null session', null],
	])('rejects %s', (_label, session) => {
		expect(isAuthenticatedSession(session)).toBe(false);
	});
});
