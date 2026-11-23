import { createEffect, onMount } from 'solid-js';
import { loadSession, sessionStatus } from './api/session';
import { LOGIN_PATH } from './paths';

/**
 * Client-side defense-in-depth gate for `/biblioteca`.
 */
export default function SessionGuard() {
	onMount(() => {
		void loadSession();
	});

	createEffect(() => {
		if (sessionStatus() !== 'anonymous') return;

		const requested = window.location.pathname + window.location.search;
		window.location.replace(`${LOGIN_PATH}?redirect=${encodeURIComponent(requested)}`);
	});

	return null;
}
