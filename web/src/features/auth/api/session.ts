import { createSignal } from 'solid-js';
import { getManagedAuthClient } from '../../../shared/api/managedAuthClient';
import type { AuthSession, AuthSessionStatus, AuthUser } from '../types';
import { getAuthClient } from './authClient';
import { readDevSession, signOutWithDev } from './devAuth';
import { getAuthMode } from './sessionMode';
import { isAuthenticatedSession } from './userSession';

const [status, setStatus] = createSignal<AuthSessionStatus>('loading');
const [session, setSession] = createSignal<AuthSession | null>(null);
let pending: Promise<void> | undefined;

export function sessionStatus(): AuthSessionStatus {
	return status();
}

export function currentSession(): AuthSession | null {
	return session();
}

export function loadSession(): Promise<void> {
	pending ??= readSession();
	return pending;
}

export function refreshSession(): Promise<void> {
	pending = undefined;
	return loadSession();
}

export async function signOut(): Promise<void> {
	const mode = await getAuthMode();
	if (mode === 'dev') {
		await signOutWithDev();
		return;
	}

	await (mode === 'neon' ? await getManagedAuthClient() : getAuthClient()).signOut();
}

export function clearSession(): void {
	pending = undefined;
	setSession(null);
	setStatus('anonymous');
}

export function displayName(user: AuthUser): string {
	const name = user.name?.trim();
	return name || user.email;
}

async function readSession(): Promise<void> {
	let next: AuthSession | null;

	try {
		const mode = await getAuthMode();
		const client = mode === 'neon' ? await getManagedAuthClient() : getAuthClient();
		next = mode === 'dev' ? await readDevSession() : await readBetterAuthSession(client);
	} catch {
		next = null;
	}

	const validSession = next && isAuthenticatedSession(next) ? next : null;
	setSession(validSession);
	setStatus(validSession ? 'authenticated' : 'anonymous');
}

async function readBetterAuthSession(
	client: ReturnType<typeof getAuthClient> | Awaited<ReturnType<typeof getManagedAuthClient>>,
): Promise<AuthSession | null> {
	const { data } = await client.getSession();
	return data as AuthSession | null;
}
