import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeIgb1, encodeIgb1, type ContentTier } from './igb1';

interface GoldenVector {
	name: string;
	bookId: string;
	tier: ContentTier;
	keyHex?: string;
	igb1Base64: string;
	expectedDocument: Record<string, unknown>;
}

function fromBase64(b64: string): Uint8Array {
	return new Uint8Array(Buffer.from(b64, 'base64'));
}

function fromHex(hex: string): Uint8Array {
	return new Uint8Array(Buffer.from(hex, 'hex'));
}

describe('Web IGB1 codec (crypto.subtle + DecompressionStream)', () => {
	it('decodes all cross-platform golden vectors from docs/specs/igb1-golden-vectors.json', async () => {
		const raw = readFileSync(resolve(process.cwd(), '../docs/specs/igb1-golden-vectors.json'), 'utf8');
		const file = JSON.parse(raw) as { vectors: GoldenVector[] };

		for (const vec of file.vectors) {
			const bytes = fromBase64(vec.igb1Base64);
			const key = vec.keyHex ? fromHex(vec.keyHex) : undefined;
			const decoded = await decodeIgb1(bytes, {
				bookId: vec.bookId,
				tier: vec.tier,
				key,
			});
			expect(decoded).toEqual(vec.expectedDocument);
		}
	});

	it('round-trips AES-256-GCM encryption and rejects wrong AAD or tampered tag', async () => {
		const key = crypto.getRandomValues(new Uint8Array(32));
		const doc = {
			bookId: '77',
			pdfPages: 4,
			ocrPending: false,
			chunks: [
				{
					id: 'c-1',
					type: 'para' as const,
					page: 1,
					offset: 0,
					text: 'Texto encriptado con Web Crypto AES-256-GCM.',
					mood: 'espera' as const,
					cues: [],
					align: 'left' as const,
				},
			],
		};

		const encoded = await encodeIgb1(doc, {
			bookId: '77',
			tier: 'private_user',
			key,
		});

		const decoded = await decodeIgb1(encoded, {
			bookId: '77',
			tier: 'private_user',
			key,
		});
		expect(decoded.chunks[0].text).toBe(doc.chunks[0].text);

		await expect(
			decodeIgb1(encoded, { bookId: '88', tier: 'private_user', key }),
		).rejects.toThrow();

		const tampered = new Uint8Array(encoded);
		tampered[tampered.length - 1] ^= 0xff;
		await expect(
			decodeIgb1(tampered, { bookId: '77', tier: 'private_user', key }),
		).rejects.toThrow();
	});
});
