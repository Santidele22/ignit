import { backendUrl, neonAuthUrl } from '../../../shared/api/serverEnvironment';
import type { AuthMode, AuthUser } from '../types';
import { isAuthenticatedSession } from './userSession';

const SESSION_CHECK_TIMEOUT_MS = 5_000;
const AUTH_MODE_TTL_MS = 60_000;

let cachedMode: { mode: AuthMode; at: number } | undefined;

async function readAuthMode(): Promise<AuthMode> {
	const now = Date.now();
	if (cachedMode && now - cachedMode.at < AUTH_MODE_TTL_MS) {
		return cachedMode.mode;
	}

	let mode: AuthMode = 'better';
	try {
		const response = await fetch(`${backendUrl}/session-mode`, {
			signal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS),
		});
		const payload = (await response.json()) as { mode?: AuthMode } | null;
		mode = payload?.mode === 'dev' || payload?.mode === 'neon' ? payload.mode : 'better';
	} catch {
		// Unreachable backend: session probe below fails closed.
	}

	cachedMode = { mode, at: now };
	return mode;
}

export type ServerSession =
	| { authenticated: false }
	| { authenticated: true; user: AuthUser; bearerToken?: string; cookie?: string };

async function readNeonToken(cookieHeader: string): Promise<string | undefined> {
	if (!neonAuthUrl) return undefined;
	try {
		const res = await fetch(`${neonAuthUrl}/token`, {
			headers: { cookie: cookieHeader, 'cache-control': 'no-store' },
			signal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS),
		});
		if (!res.ok) return undefined;
		const payload = (await res.json().catch(() => null)) as { token?: unknown } | null;
		return typeof payload?.token === 'string' && payload.token.length > 0 ? payload.token : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Resolves any valid authenticated user session and SSR credential
 * (`bearerToken` in Neon mode, `cookie` in Better/Dev mode).
 */
export async function getServerSession(cookieHeader: string | null): Promise<ServerSession> {
	if (!cookieHeader) {
		return { authenticated: false };
	}

	const mode = await readAuthMode();
	const sessionUrl =
		mode === 'dev'
			? `${backendUrl}/api/auth/dev-session`
			: mode === 'neon'
				? `${neonAuthUrl}/get-session`
				: `${backendUrl}/api/auth/get-session`;

	try {
		const response = await fetch(sessionUrl, {
			headers: { cookie: cookieHeader, 'cache-control': 'no-store' },
			signal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS),
		});
		if (!response.ok) {
			return { authenticated: false };
		}

		const data: unknown = await response.json().catch(() => null);
		if (!isAuthenticatedSession(data)) {
			return { authenticated: false };
		}

		if (mode === 'neon') {
			const headerJwt = response.headers.get('set-auth-jwt');
			const bearerToken =
				typeof headerJwt === 'string' && headerJwt.length > 0
					? headerJwt
					: await readNeonToken(cookieHeader);
			if (!bearerToken) {
				return { authenticated: false };
			}
			return { authenticated: true, user: data.user, bearerToken };
		}

		return { authenticated: true, user: data.user, cookie: cookieHeader };
	} catch {
		return { authenticated: false };
	}
}

export async function hasAuthenticatedSession(cookieHeader: string | null): Promise<boolean> {
	return (await getServerSession(cookieHeader)).authenticated;
}
