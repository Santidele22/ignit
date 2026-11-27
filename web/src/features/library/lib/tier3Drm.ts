import type { ContentTier } from './igb1';

const ZW_DIGITS = ['\u200B', '\u200C', '\u200D', '\uFEFF'] as const;
const ZW_SENTINEL = '\u2060'; // Word joiner framing sentinel

export const DEFAULT_TIER3_MAX_QUOTE_CHARS = 280;

export function encodeForensicWatermark(
	text: string,
	userId: string,
	licenseId: string,
): string {
	const payload = `${userId}|${licenseId}`;
	const bytes = new TextEncoder().encode(payload);
	let encoded = ZW_SENTINEL;
	for (const b of bytes) {
		encoded += ZW_DIGITS[(b >> 6) & 0x03];
		encoded += ZW_DIGITS[(b >> 4) & 0x03];
		encoded += ZW_DIGITS[(b >> 2) & 0x03];
		encoded += ZW_DIGITS[b & 0x03];
	}
	encoded += ZW_SENTINEL;
	return `${text}${encoded}`;
}

export function extractForensicWatermark(
	watermarkedText: string,
): { userId: string; licenseId: string } | null {
	const start = watermarkedText.indexOf(ZW_SENTINEL);
	const end = watermarkedText.lastIndexOf(ZW_SENTINEL);
	if (start === -1 || end <= start + 1) return null;

	const body = watermarkedText.slice(start + 1, end);
	if (body.length === 0 || body.length % 4 !== 0) return null;

	const bytes: number[] = [];
	for (let i = 0; i < body.length; i += 4) {
		const d0 = ZW_DIGITS.indexOf(body[i] as (typeof ZW_DIGITS)[number]);
		const d1 = ZW_DIGITS.indexOf(body[i + 1] as (typeof ZW_DIGITS)[number]);
		const d2 = ZW_DIGITS.indexOf(body[i + 2] as (typeof ZW_DIGITS)[number]);
		const d3 = ZW_DIGITS.indexOf(body[i + 3] as (typeof ZW_DIGITS)[number]);
		if (d0 < 0 || d1 < 0 || d2 < 0 || d3 < 0) return null;
		bytes.push((d0 << 6) | (d1 << 4) | (d2 << 2) | d3);
	}

	const decoded = new TextDecoder().decode(new Uint8Array(bytes));
	const sep = decoded.indexOf('|');
	if (sep <= 0) return null;
	return {
		userId: decoded.slice(0, sep),
		licenseId: decoded.slice(sep + 1),
	};
}

export function guardCopySelection(
	selectedText: string,
	contentTier: ContentTier,
	maxQuoteChars = DEFAULT_TIER3_MAX_QUOTE_CHARS,
): { allowed: boolean; text: string; reason?: string } {
	if (contentTier !== 'editorial_closed') {
		return { allowed: true, text: selectedText };
	}
	if (selectedText.length > maxQuoteChars) {
		return {
			allowed: false,
			text: selectedText.slice(0, maxQuoteChars),
			reason: `En libros editoriales (Tier 3) solo se permiten citas de hasta ${maxQuoteChars} caracteres.`,
		};
	}
	return { allowed: true, text: selectedText };
}
