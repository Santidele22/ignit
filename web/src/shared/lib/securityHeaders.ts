import { isReaderRoute } from '../../features/auth/paths';

export interface SecurityHeaderOptions {
	pathname: string;
	isHttps: boolean;
	allowEvalForAuth: boolean;
}

/**
 * Only individual book reader routes (`/lecturas/:id`) may be framed by
 * same-origin pages (Section IV live embed on `/`). Every other route stays
 * strictly `frame-ancestors 'none'`.
 */
export function frameAncestorsForPath(pathname: string): string {
	return isReaderRoute(pathname) ? "frame-ancestors 'self'" : "frame-ancestors 'none'";
}

export function applySecurityHeaders(
	headers: Headers,
	options: SecurityHeaderOptions,
): void {
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

	if (options.allowEvalForAuth) {
		const csp = headers.get('Content-Security-Policy');
		if (csp) {
			headers.set(
				'Content-Security-Policy',
				csp.replaceAll('script-src ', "script-src 'unsafe-eval' "),
			);
		}
	}

	headers.append('Content-Security-Policy', frameAncestorsForPath(options.pathname));
	if (options.isHttps) {
		headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
}
