import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getAuthMode: vi.fn(),
	getAuthClient: vi.fn(),
	getManagedAuthClient: vi.fn(),
	readDevSession: vi.fn(),
}));

vi.mock('./sessionMode', () => ({
	getAuthMode: mocks.getAuthMode,
}));

vi.mock('./authClient', () => ({
	getAuthClient: mocks.getAuthClient,
}));

vi.mock('../../../shared/api/managedAuthClient', () => ({
	getManagedAuthClient: mocks.getManagedAuthClient,
}));

vi.mock('./devAuth', () => ({
	readDevSession: mocks.readDevSession,
	signOutWithDev: vi.fn(),
}));

describe('loadSession', () => {
	beforeEach(() => {
		vi.resetModules();
		mocks.getAuthMode.mockReset();
		mocks.getAuthClient.mockReset();
		mocks.getManagedAuthClient.mockReset();
		mocks.readDevSession.mockReset();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('reads dev session without initializing Better Auth or Neon Auth clients', async () => {
		mocks.getAuthMode.mockResolvedValue('dev');
		mocks.getAuthClient.mockImplementation(() => {
			throw new Error('Better Auth client must not be initialized in dev mode');
		});
		mocks.readDevSession.mockResolvedValue({
			user: { id: 'u1', email: 'reader@ignit.local', name: 'Reader', role: 'user' },
		});

		const { loadSession, sessionStatus, currentSession } = await import('./session');
		await loadSession();

		expect(mocks.getAuthClient).not.toHaveBeenCalled();
		expect(mocks.getManagedAuthClient).not.toHaveBeenCalled();
		expect(sessionStatus()).toBe('authenticated');
		expect(currentSession()).toEqual({
			user: { id: 'u1', email: 'reader@ignit.local', name: 'Reader', role: 'user' },
		});
	});
});
