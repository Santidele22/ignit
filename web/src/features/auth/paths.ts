export const LOGIN_PATH = '/login';
export const REGISTER_PATH = '/registro';
export const LIBRARY_PATH = '/biblioteca';

/**
 * Individual book reader routes (`/lecturas/:id`) decide public vs private
 * visibility per book and user, so middleware does not blanket-block them.
 */
export function isReaderRoute(pathname: string): boolean {
	return /^\/lecturas\/[^/]+\/?$/.test(pathname);
}

/**
 * Routes where Better Auth client schemas (`new Function`) or the reader run,
 * requiring `'unsafe-eval'` in CSP `script-src`.
 */
export function isAuthSecurityScope(pathname: string): boolean {
	const clean = pathname.replace(/\/+$/, '') || '/';
	return (
		clean === LOGIN_PATH ||
		clean === REGISTER_PATH ||
		clean === LIBRARY_PATH ||
		clean.startsWith(`${LIBRARY_PATH}/`) ||
		isReaderRoute(pathname)
	);
}

/** Only personal library routes require an authenticated session at middleware level. */
export function isProtectedRoute(pathname: string): boolean {
	const clean = pathname.replace(/\/+$/, '') || '/';
	return clean === LIBRARY_PATH || clean.startsWith(`${LIBRARY_PATH}/`);
}

/**
 * Resolves the post-login/register redirect target without allowing open redirects.
 */
export function safeRedirectTarget(requested: string | null | undefined): string {
	if (!requested || !requested.startsWith('/') || requested.startsWith('//') || requested.includes('\\')) {
		return LIBRARY_PATH;
	}

	const pathname = requested.split(/[?#]/, 1)[0] ?? '';
	const clean = pathname.replace(/\/+$/, '') || '/';
	if (
		clean === '/' ||
		clean === LIBRARY_PATH ||
		clean.startsWith(`${LIBRARY_PATH}/`) ||
		isReaderRoute(pathname)
	) {
		return requested;
	}

	return LIBRARY_PATH;
}
