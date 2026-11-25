import { describe, expect, it } from 'vitest';
import { BOOK_KIND_OPTIONS, getBookKindLabel, isBookKind, parseBookKind } from './types';

describe('BookKind taxonomy (S6 — estudio disciplines)', () => {
	it('accepts the four professional-discipline kinds', () => {
		for (const kind of ['derecho', 'medicina', 'economia', 'diseno'] as const) {
			expect(isBookKind(kind), kind).toBe(true);
			expect(parseBookKind(kind), kind).toBe(kind);
		}
	});

	it('labels the new kinds exactly as the 04 artboard disciplines', () => {
		expect(getBookKindLabel('derecho')).toBe('Derecho y Leyes');
		expect(getBookKindLabel('medicina')).toBe('Medicina y Salud');
		expect(getBookKindLabel('economia')).toBe('Economía y Negocios');
		expect(getBookKindLabel('diseno')).toBe('Diseño y Arquitectura');
	});

	it('keeps every option unique and lowercase without diacritics', () => {
		const values = BOOK_KIND_OPTIONS.map((option) => option.value);
		expect(new Set(values).size).toBe(values.length);
		for (const value of values) {
			expect(value).toMatch(/^[a-z_]+$/);
		}
	});

	it('still rejects unknown kinds', () => {
		expect(isBookKind('medieval')).toBe(false);
		expect(parseBookKind(null)).toBe('no_tecnico');
	});
});
