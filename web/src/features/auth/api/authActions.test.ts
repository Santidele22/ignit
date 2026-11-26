import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getAuthMode: vi.fn(),
	refreshSession: vi.fn(),
}));

vi.mock('./sessionMode', () => ({
	getAuthMode: mocks.getAuthMode,
}));

vi.mock('./session', () => ({
	refreshSession: mocks.refreshSession,
}));

import { signInWithEmail, signUpWithEmail } from './authActions';

describe('signUpWithEmail in dev mode', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		import.meta.env.SSR = false;
		mocks.getAuthMode.mockReset();
		mocks.refreshSession.mockReset();
		mocks.getAuthMode.mockResolvedValue('dev');
		mocks.refreshSession.mockResolvedValue(undefined);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('posts to /api/auth/dev-register and refreshes session on success', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					user: { id: 'u1', name: 'Santi', email: 'santi@example.com', role: 'user' },
				}),
				{ status: 201, headers: { 'Content-Type': 'application/json' } },
			),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		const result = await signUpWithEmail('  Santi ', '  santi@example.com ', 'password123');

		expect(result).toEqual({ error: null });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/auth/dev-register');
		expect(init.method).toBe('POST');
		expect(init.credentials).toBe('include');
		expect(JSON.parse(String(init.body))).toEqual({
			name: 'Santi',
			email: 'santi@example.com',
			password: 'password123',
		});
		expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
	});

	it('returns status and backend message when dev-register rejects duplicate email', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({ message: 'Ya existe una cuenta registrada con ese correo.' }),
				{ status: 409, headers: { 'Content-Type': 'application/json' } },
			),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		const result = await signUpWithEmail('Santi', 'santi@example.com', 'password123');

		expect(result).toEqual({
			error: {
				status: 409,
				message: 'Ya existe una cuenta registrada con ese correo.',
			},
		});
		expect(mocks.refreshSession).not.toHaveBeenCalled();
	});

	it('surfaces the first validation message from a NestJS 400 array payload', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					statusCode: 400,
					message: ['password must be longer than or equal to 8 characters'],
				}),
				{ status: 400, headers: { 'Content-Type': 'application/json' } },
			),
		) as typeof fetch;

		const result = await signUpWithEmail('Santi', 'santi@example.com', '123');

		expect(result).toEqual({
			error: {
				status: 400,
				message: 'password must be longer than or equal to 8 characters',
			},
		});
		expect(mocks.refreshSession).not.toHaveBeenCalled();
	});
});

describe('signInWithEmail in dev mode', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		import.meta.env.SSR = false;
		mocks.getAuthMode.mockReset();
		mocks.refreshSession.mockReset();
		mocks.getAuthMode.mockResolvedValue('dev');
		mocks.refreshSession.mockResolvedValue(undefined);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('posts trimmed credentials to /api/auth/dev-login and refreshes session on success', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					user: { id: 'u1', name: 'Santi', email: 'santi@example.com', role: 'user' },
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		const result = await signInWithEmail('  santi@example.com ', 'password123');

		expect(result).toEqual({
			error: null,
			user: { id: 'u1', name: 'Santi', email: 'santi@example.com', role: 'user' },
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/auth/dev-login');
		expect(init.method).toBe('POST');
		expect(init.credentials).toBe('include');
		expect(JSON.parse(String(init.body))).toEqual({
			email: 'santi@example.com',
			password: 'password123',
		});
		expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
	});

	it('preserves 401 and 429 HTTP statuses from dev-login without throwing', async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ statusCode: 401, message: 'Unauthorized' }), {
					status: 401,
					headers: { 'Content-Type': 'application/json' },
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ statusCode: 429, message: 'ThrottlerException: Too Many Requests' }), {
					status: 429,
					headers: { 'Content-Type': 'application/json' },
				}),
			) as typeof fetch;

		await expect(signInWithEmail('santi@example.com', 'wrong')).resolves.toEqual({
			error: { status: 401, message: 'Unauthorized' },
		});
		await expect(signInWithEmail('santi@example.com', 'wrong')).resolves.toEqual({
			error: { status: 429, message: 'ThrottlerException: Too Many Requests' },
		});
		expect(mocks.refreshSession).not.toHaveBeenCalled();
	});
});
