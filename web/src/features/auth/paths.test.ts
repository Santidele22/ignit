import { describe, expect, it } from 'vitest';
import {
	isAuthSecurityScope,
	isProtectedRoute,
	isReaderRoute,
	LIBRARY_PATH,
	safeRedirectTarget,
} from './paths';

describe('isReaderRoute', () => {
	it.each([
		['/lecturas/1', true],
		['/lecturas/42/', true],
		['/lecturas/abc', true],
		['/lecturas', false],
		['/lecturas/', false],
		['/lecturas/1/extra', false],
		['/biblioteca', false],
	])('%s → reader=%j', (pathname, expected) => {
		expect(isReaderRoute(pathname)).toBe(expected);
	});
});

describe('isProtectedRoute and isAuthSecurityScope', () => {
	it.each([
		['/biblioteca', true, true],
		['/biblioteca/', true, true],
		['/admin', false, true],
		['/admin/', false, true],
		['/login', false, true],
		['/registro', false, true],
		['/lecturas/7', false, true],
		['/lecturas/7/', false, true],
		['/', false, false],
	])('%s → protected=%j, authCsp=%j', (pathname, expectedProtected, expectedCsp) => {
		expect(isProtectedRoute(pathname)).toBe(expectedProtected);
		expect(isAuthSecurityScope(pathname)).toBe(expectedCsp);
	});
});

describe('safeRedirectTarget', () => {
	it('allows safe Ignit routes and blocks open redirects', () => {
		expect(safeRedirectTarget('/biblioteca')).toBe('/biblioteca');
		expect(safeRedirectTarget('/admin')).toBe('/admin');
		expect(safeRedirectTarget('/lecturas/7')).toBe('/lecturas/7');
		expect(safeRedirectTarget('/lecturas/7?foo=1')).toBe('/lecturas/7?foo=1');
		expect(safeRedirectTarget('/')).toBe('/');
		expect(safeRedirectTarget('//evil.com')).toBe(LIBRARY_PATH);
		expect(safeRedirectTarget('https://evil.com/lecturas/7')).toBe(LIBRARY_PATH);
		expect(safeRedirectTarget('/\\evil.com')).toBe(LIBRARY_PATH);
		expect(safeRedirectTarget(null)).toBe(LIBRARY_PATH);
	});
});
