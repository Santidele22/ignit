import { describe, expect, it } from 'vitest';
import {
	encodeForensicWatermark,
	extractForensicWatermark,
	guardCopySelection,
} from './tier3Drm';

describe('Tier 3 DRM protections (watermark + mass copy guard)', () => {
	it('encodes and extracts invisible forensic watermark without altering visible text', () => {
		const original = 'Este es un párrafo protegido de prueba.';
		const watermarked = encodeForensicWatermark(original, 'user-42', 'lic-99');

		expect(watermarked.startsWith(original)).toBe(true);
		expect(extractForensicWatermark(watermarked)).toEqual({
			userId: 'user-42',
			licenseId: 'lic-99',
		});
		expect(extractForensicWatermark(original)).toBeNull();
	});

	it('blocks mass copy on editorial_closed while allowing short quotes and non-Tier3 books', () => {
		const short = 'Cita breve';
		expect(guardCopySelection(short, 'editorial_closed').allowed).toBe(true);

		const massive = 'a'.repeat(500);
		const blocked = guardCopySelection(massive, 'editorial_closed');
		expect(blocked.allowed).toBe(false);
		expect(blocked.text).toHaveLength(280);
		expect(blocked.reason).toMatch(/Tier 3/);

		expect(guardCopySelection(massive, 'public_open').allowed).toBe(true);
	});
});
