import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../shared/api/serverEnvironment', () => ({
	backendUrl: 'https://render.example',
	neonAuthUrl: 'https://neon-auth.example',
}));

const jsonResponse = (body: unknown, status = 200, headers?: Record<string, string>) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...headers },
	});

let fetchStub: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.resetModules();
	fetchStub = vi.fn();
	vi.stubGlobal('fetch', fetchStub);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('getServerSession', () => {
	it('returns authenticated=false without hitting the network when cookieHeader is missing', async () => {
		const { getServerSession } = await import('./serverSession');
		await expect(getServerSession(null)).resolves.toEqual({ authenticated: false });
		expect(fetchStub).not.toHaveBeenCalled();
	});

	it('returns bearerToken and user from set-auth-jwt in neon mode for a standard user', async () => {
		fetchStub
			.mockResolvedValueOnce(jsonResponse({ mode: 'neon' }))
			.mockResolvedValueOnce(
				jsonResponse(
					{ user: { id: 'u1', email: 'reader@ignit.app', name: 'Alice', role: 'user' } },
					200,
					{ 'set-auth-jwt': 'jwt-from-header' },
				),
			);

		const { getServerSession } = await import('./serverSession');
		await expect(getServerSession('neon.sid=abc')).resolves.toEqual({
			authenticated: true,
			user: { id: 'u1', email: 'reader@ignit.app', name: 'Alice', role: 'user' },
			bearerToken: 'jwt-from-header',
		});
	});

	it('falls back to /token in neon mode when set-auth-jwt header is absent', async () => {
		fetchStub
			.mockResolvedValueOnce(jsonResponse({ mode: 'neon' }))
			.mockResolvedValueOnce(jsonResponse({ user: { id: 'u1', email: 'a@b.com', role: 'authenticated' } }))
			.mockResolvedValueOnce(jsonResponse({ token: 'jwt-from-token-endpoint' }));

		const { getServerSession } = await import('./serverSession');
		await expect(getServerSession('neon.sid=abc')).resolves.toEqual({
			authenticated: true,
			user: { id: 'u1', email: 'a@b.com', role: 'authenticated' },
			bearerToken: 'jwt-from-token-endpoint',
		});
	});

	it('returns cookie in dev/better mode for any valid user and rejects missing user', async () => {
		fetchStub
			.mockResolvedValueOnce(jsonResponse({ mode: 'better' }))
			.mockResolvedValueOnce(jsonResponse({ user: { id: 'u2', email: 'u@b.com', role: 'user' } }));

		const { getServerSession, hasAuthenticatedSession } = await import('./serverSession');
		await expect(getServerSession('better.sid=xyz')).resolves.toEqual({
			authenticated: true,
			user: { id: 'u2', email: 'u@b.com', role: 'user' },
			cookie: 'better.sid=xyz',
		});

		fetchStub.mockResolvedValueOnce(jsonResponse(null));
		await expect(hasAuthenticatedSession('better.sid=invalid')).resolves.toBe(false);
	});

	it('fails closed in neon mode when neither set-auth-jwt nor /token yields a bearer JWT', async () => {
		fetchStub
			.mockResolvedValueOnce(jsonResponse({ mode: 'neon' }))
			.mockResolvedValueOnce(jsonResponse({ user: { id: 'u1', email: 'a@b.com', role: 'user' } }))
			.mockResolvedValueOnce(jsonResponse({}, 401));

		const { getServerSession } = await import('./serverSession');
		await expect(getServerSession('neon.sid=abc')).resolves.toEqual({ authenticated: false });
	});
});
