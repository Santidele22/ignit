import { getJson, postJson, resolveApiUrl } from '../../../shared/api/http';
import type { AuthSession, AuthUser, DevSessionSnapshot } from '../types';

/** Result shape of the dev auth actions, mirroring the Better Auth client's `error`. */
export type DevAuthResult = { error: { status: number; message?: string } | null; user?: AuthUser };
export type DevSignInResult = DevAuthResult;

async function postDevAuth(path: string, body: Record<string, string>): Promise<DevAuthResult> {
	const url = await resolveApiUrl(path);
	const response = await fetch(url, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

	if (response.ok) {
		const payload = (await response.json().catch(() => null)) as { user?: AuthUser } | null;
		return {
			error: null,
			...(payload?.user ? { user: payload.user } : {}),
		};
	}

	const payload = (await response.json().catch(() => null)) as {
		message?: string | string[];
	} | null;
	const message = Array.isArray(payload?.message) ? payload.message[0] : payload?.message;

	return {
		error: {
			status: response.status,
			...(typeof message === 'string' && message.length > 0 ? { message } : {}),
		},
	};
}

/**
 * Registers a local test account against `POST /api/auth/dev-register`
 * (`AUTH_MODE=dev`). Sets the signed HttpOnly session cookie on success.
 */
export async function signUpWithDev(
	name: string,
	email: string,
	password: string,
): Promise<DevAuthResult> {
	return postDevAuth('/auth/dev-register', { name, email, password });
}

/**
 * Signs in against the interim dev API (`AUTH_MODE=dev`). The API sets the
 * signed, HttpOnly session cookie; `credentials: 'include'` is already part of
 * the shared helpers.
 */
export async function signInWithDev(
	email: string,
	password: string,
): Promise<DevSignInResult> {
	return postDevAuth('/auth/dev-login', { email, password });
}

/** Session snapshot of the interim dev API; `null` when there is no session. */
export async function readDevSession(): Promise<AuthSession | null> {
	try {
		const snapshot = await getJson<DevSessionSnapshot>('/auth/dev-session');

		return { user: snapshot.user };
	} catch {
		return null;
	}
}

/** Expires the interim dev session cookie. */
export async function signOutWithDev(): Promise<void> {
	await postJson('/auth/dev-logout', {});
}
