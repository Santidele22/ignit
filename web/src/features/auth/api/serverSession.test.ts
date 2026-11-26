import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({
	backendUrl: 'https://render.example',
	neonAuthUrl: 'https://neon-auth.example' as string | undefined,
}));

vi.mock('../../../shared/api/serverEnvironment', () => envMock);

const jsonResponse = (body: unknown, status = 200, headers?: Record<string, string>) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...headers },
	});

let fetchStub: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.resetModules();
	envMock.neonAuthUrl = 'https://neon-auth.example';
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

	it('resolves neon mode directly from neonAuthUrl without calling backend /session-mode (survives Render 502)', async () => {
		fetchStub.mockImplementation((input: unknown) => {
			if (String(input).startsWith('https://render.example')) {
				return Promise.resolve(new Response('Bad Gateway', { status: 502 }));
			}
			return Promise.resolve(
				jsonResponse(
					{ user: { id: 'u1', email: 'reader@ignit.app', name: 'Alice', role: 'user' } },
					200,
					{ 'set-auth-jwt': 'jwt-from-header' },
				),
			);
		});

		const { getServerSession } = await import('./serverSession');
		await expect(getServerSession('neon.sid=abc')).resolves.toEqual({
			authenticated: true,
			user: { id: 'u1', email: 'reader@ignit.app', name: 'Alice', role: 'user' },
			bearerToken: 'jwt-from-header',
		});
		expect(fetchStub).toHaveBeenCalledTimes(1);
		expect(fetchStub.mock.calls[0]?.[0]).toBe('https://neon-auth.example/get-session');
	});

	it('falls back to /token in neon mode when set-auth-jwt header is absent', async () => {
		fetchStub
			.mockResolvedValueOnce(jsonResponse({ user: { id: 'u1', email: 'a@b.com', role: 'authenticated' } }))
			.mockResolvedValueOnce(jsonResponse({ token: 'jwt-from-token-endpoint' }));

		const { getServerSession } = await import('./serverSession');
		await expect(getServerSession('neon.sid=abc')).resolves.toEqual({
			authenticated: true,
			user: { id: 'u1', email: 'a@b.com', role: 'authenticated' },
			bearerToken: 'jwt-from-token-endpoint',
		});
	});

	it('returns cookie in dev/better mode when neonAuthUrl is absent and does not cache backend 502 fallbacks', async () => {
		envMock.neonAuthUrl = undefined;
		fetchStub
			.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }))
			.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }))
			.mockResolvedValueOnce(jsonResponse({ mode: 'dev' }))
			.mockResolvedValueOnce(jsonResponse({ user: { id: 'u2', email: 'u@b.com', role: 'user' } }));

		const { getServerSession, hasAuthenticatedSession } = await import('./serverSession');
		// First call hits a cold backend 502 and fails closed without poisoning cachedMode.
		await expect(getServerSession('dev.sid=xyz')).resolves.toEqual({ authenticated: false });

		// Next call re-probes /session-mode and resolves dev mode cleanly.
		await expect(getServerSession('dev.sid=xyz')).resolves.toEqual({
			authenticated: true,
			user: { id: 'u2', email: 'u@b.com', role: 'user' },
			cookie: 'dev.sid=xyz',
		});

		fetchStub.mockResolvedValueOnce(jsonResponse(null));
		await expect(hasAuthenticatedSession('dev.sid=invalid')).resolves.toBe(false);
	});

	it('fails closed in neon mode when neither set-auth-jwt nor /token yields a bearer JWT', async () => {
		fetchStub
			.mockResolvedValueOnce(jsonResponse({ user: { id: 'u1', email: 'a@b.com', role: 'user' } }))
			.mockResolvedValueOnce(jsonResponse({}, 401));

		const { getServerSession } = await import('./serverSession');
		await expect(getServerSession('neon.sid=abc')).resolves.toEqual({ authenticated: false });
	});
});
