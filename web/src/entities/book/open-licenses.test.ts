import { describe, expect, it } from 'vitest';
import {
	OPEN_LICENSE_OPTIONS,
	OPEN_LICENSE_REQUIRED_MESSAGE,
	formatLicenseBadge,
	isOpenLicense,
} from './open-licenses';
import { EMPTY_BOOK_FORM, validateBookForm } from '../../features/book/bookForm';

describe('open-licenses (web)', () => {
	it('accepts canonical open licenses and rejects empty or copyrighted labels', () => {
		for (const license of OPEN_LICENSE_OPTIONS) {
			expect(isOpenLicense(license)).toBe(true);
		}
		expect(isOpenLicense(null)).toBe(false);
		expect(isOpenLicense('')).toBe(false);
		expect(isOpenLicense('Todos los derechos reservados')).toBe(false);
		expect(isOpenLicense('Autorización editorial')).toBe(false);
		expect(isOpenLicense('Creative Commons no aplica')).toBe(false);
		expect(isOpenLicense('Open Source? No')).toBe(false);
		expect(isOpenLicense('Dominio público: no (todos los derechos reservados)')).toBe(false);
	});

	it('formats compact license badges for catalog cards', () => {
		expect(formatLicenseBadge(null)).toBeNull();
		expect(formatLicenseBadge('   ')).toBeNull();
		expect(formatLicenseBadge('CC BY-SA 4.0')).toBe('CC BY-SA 4.0');
		expect(formatLicenseBadge('Dominio público')).toBe('Dominio público');
		expect(formatLicenseBadge('Licencia Open Source (MIT / Apache / GPL / BSD)')).toBe('Open Source');
		expect(formatLicenseBadge('Documentación libre (GFDL / Open Docs)')).toBe('Docs libres');
	});

	it('requires an open license in validateBookForm only when published is true', () => {
		const base = {
			...EMPTY_BOOK_FORM,
			title: 'Libro de prueba',
			author: 'Autora',
			description: 'Descripción válida.',
		};

		expect(validateBookForm({ ...base, published: false, license: '' })).toBeNull();
		expect(validateBookForm({ ...base, published: true, license: '' })).toBe(
			OPEN_LICENSE_REQUIRED_MESSAGE,
		);
		expect(validateBookForm({ ...base, published: true, license: 'CC BY 4.0' })).toBeNull();
	});
});
