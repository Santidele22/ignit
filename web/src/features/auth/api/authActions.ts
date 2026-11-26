import { getManagedAuthClient } from '../../../shared/api/managedAuthClient';
import type { AuthUser } from '../types';
import { getAuthClient } from './authClient';
import { signInWithDev, signOutWithDev, signUpWithDev } from './devAuth';
import { refreshSession } from './session';
import { getAuthMode } from './sessionMode';

export type AuthActionError = { status?: number; message?: string; code?: string } | null;

export async function signInWithEmail(
	email: string,
	password: string,
): Promise<{ error: AuthActionError; user?: AuthUser }> {
	const mode = await getAuthMode();
	const cleanEmail = email.trim();

	if (mode === 'dev') {
		const res = await signInWithDev(cleanEmail, password);
		if (!res.error) await refreshSession();
		return res;
	}

	const client = mode === 'neon' ? await getManagedAuthClient() : getAuthClient();
	const res = await client.signIn.email({ email: cleanEmail, password });
	const user = (res.data as { user?: AuthUser } | null | undefined)?.user;
	return {
		error: (res.error as AuthActionError) ?? null,
		...(user ? { user } : {}),
	};
}

export async function signUpWithEmail(
	name: string,
	email: string,
	password: string,
): Promise<{ error: AuthActionError }> {
	const mode = await getAuthMode();
	const cleanName = name.trim();
	const cleanEmail = email.trim();

	if (mode === 'dev') {
		const res = await signUpWithDev(cleanName, cleanEmail, password);
		if (!res.error) await refreshSession();
		return { error: res.error };
	}

	const client = mode === 'neon' ? await getManagedAuthClient() : getAuthClient();
	const res = await client.signUp.email({
		name: cleanName,
		email: cleanEmail,
		password,
	});
	return { error: (res.error as AuthActionError) ?? null };
}

/**
 * Lightweight sign-out helper safe on pages without `'unsafe-eval'` CSP (avoids
 * loading `better-auth/solid` schema compilers on public landing pages).
 */
export async function signOutCleanly(): Promise<void> {
	const mode = await getAuthMode();
	if (mode === 'dev') {
		await signOutWithDev();
		return;
	}

	if (mode === 'neon') {
		await (await getManagedAuthClient()).signOut();
		return;
	}

	const apiBase = (import.meta.env.PUBLIC_API_BASE_URL || '/api').replace(/\/+$/, '');
	await fetch(`${apiBase}/auth/sign-out`, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: '{}',
	});
}
