import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	applySecurityHeaders,
	frameAncestorsForPath,
} from './securityHeaders';

describe('security headers and CSP frame scoping', () => {
	it('allows same-origin framing only on individual reader routes (/lecturas/:id)', () => {
		expect(frameAncestorsForPath('/lecturas/4')).toBe("frame-ancestors 'self'");
		expect(frameAncestorsForPath('/lecturas/42/')).toBe("frame-ancestors 'self'");
		expect(frameAncestorsForPath('/lecturas/abc-123')).toBe("frame-ancestors 'self'");
	});

	it('forbids framing on all non-reader routes including /, auth, library, api, and nested reader paths', () => {
		expect(frameAncestorsForPath('/')).toBe("frame-ancestors 'none'");
		expect(frameAncestorsForPath('/login')).toBe("frame-ancestors 'none'");
		expect(frameAncestorsForPath('/registro')).toBe("frame-ancestors 'none'");
		expect(frameAncestorsForPath('/biblioteca')).toBe("frame-ancestors 'none'");
		expect(frameAncestorsForPath('/biblioteca/4')).toBe("frame-ancestors 'none'");
		expect(frameAncestorsForPath('/api/books')).toBe("frame-ancestors 'none'");
		expect(frameAncestorsForPath('/lecturas')).toBe("frame-ancestors 'none'");
		expect(frameAncestorsForPath('/lecturas/4/extra')).toBe("frame-ancestors 'none'");
	});

	it('applies baseline security headers and preserves existing CSP behavior', () => {
		const headers = new Headers({
			'Content-Security-Policy': "default-src 'none'; script-src 'self'",
		});

		applySecurityHeaders(headers, {
			pathname: '/login',
			isHttps: true,
			allowEvalForAuth: true,
		});

		expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
		expect(headers.get('Strict-Transport-Security')).toBe(
			'max-age=31536000; includeSubDomains',
		);
		const csp = headers.get('Content-Security-Policy') ?? '';
		expect(csp).toContain("script-src 'unsafe-eval' 'self'");
		expect(csp).toContain("frame-ancestors 'none'");
	});

	it('sets frame-ancestors self on reader routes without HSTS on plain http', () => {
		const headers = new Headers({
			'Content-Security-Policy': "default-src 'none'; script-src 'self'",
		});

		applySecurityHeaders(headers, {
			pathname: '/lecturas/4',
			isHttps: false,
			allowEvalForAuth: true,
		});

		expect(headers.get('Strict-Transport-Security')).toBeNull();
		const csp = headers.get('Content-Security-Policy') ?? '';
		expect(csp).toContain("frame-ancestors 'self'");
		expect(csp).not.toContain("frame-ancestors 'none'");
	});

	it('registers frame-src self in astro.config.mjs while keeping default-src none', () => {
		const webRoot = path.resolve(import.meta.dirname, '../../..');
		const astroConfig = fs.readFileSync(path.join(webRoot, 'astro.config.mjs'), 'utf8');

		expect(astroConfig).toContain("default-src 'none'");
		expect(astroConfig).toContain("frame-src 'self'");
	});
});
