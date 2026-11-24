import { describe, expect, it } from 'vitest';
import { isAdminSession } from './admin-access';

describe('admin session predicate (S5)', () => {
	it('accepts the plain admin role', () => {
		expect(isAdminSession({ role: 'admin' })).toBe(true);
	});

	it('accepts admin anywhere in a comma-separated role list', () => {
		expect(isAdminSession({ role: 'user,admin' })).toBe(true);
		expect(isAdminSession({ role: 'admin,user' })).toBe(true);
		expect(isAdminSession({ role: ' user , admin ' })).toBe(true);
	});

	it('accepts an array role list, mirroring the backend predicate', () => {
		expect(isAdminSession({ role: ['user', 'admin'] })).toBe(true);
		expect(isAdminSession({ role: ['user'] })).toBe(false);
	});

	it('rejects non-admin roles without substring matching', () => {
		expect(isAdminSession({ role: 'user' })).toBe(false);
		expect(isAdminSession({ role: 'administrator' })).toBe(false);
		expect(isAdminSession({ role: '' })).toBe(false);
		expect(isAdminSession({ role: 'admin-reader' })).toBe(false);
	});

	it('rejects a missing role, a null role and a missing session user', () => {
		expect(isAdminSession({})).toBe(false);
		expect(isAdminSession({ role: undefined })).toBe(false);
		expect(isAdminSession({ role: null })).toBe(false);
		expect(isAdminSession(null)).toBe(false);
		expect(isAdminSession(undefined)).toBe(false);
	});
});
