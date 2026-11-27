import { describe, expect, it } from 'vitest';
import { prepareBookDisplayItems } from './displayItems';
import { isDialogueText, looksLikeSpokenProse } from './dialogue';
import type { ReadingChunk } from '../../../entities/book/types';

function makeChunk(overrides: Partial<ReadingChunk> & { id: string; text: string }): ReadingChunk {
	return {
		type: 'para',
		page: 1,
		offset: 0,
		mood: 'espera',
		cues: [],
		...overrides,
	};
}

describe('dialogue detection and legacy chunk rescue', () => {
	it('detects em-dash and quoted speech with speech verbs without matching code', () => {
		expect(isDialogueText('—¿Quién es? —exclamó. Su voz estaba crispada.')).toBe(true);
		expect(isDialogueText('«Muy bien. Hablemos», dijo Vashti.')).toBe(true);
		expect(isDialogueText("'¿Quién es?' exclamó.")).toBe(true);
		expect(isDialogueText('const x = 1;')).toBe(false);
		expect(isDialogueText('—comentario o flag --verbose')).toBe(false);
		expect(looksLikeSpokenProse('Sonó un timbre eléctrico. La mujer presionó un interruptor y la música se detuvo.')).toBe(true);
		expect(looksLikeSpokenProse('function sum(a, b) { return a + b; }')).toBe(false);
	});

	it('rescues misclassified meta, code, and quote dialogue chunks into dialogue display items', () => {
		const chunks: ReadingChunk[] = [
			makeChunk({
				id: 'c1',
				type: 'meta',
				text: '—¿Quién es? —exclamó. Su voz estaba crispada.',
			}),
			makeChunk({
				id: 'c2',
				type: 'code',
				text: '«Muy bien. Hablemos», dijo Vashti mirando la placa.',
			}),
			makeChunk({
				id: 'c3',
				type: 'code',
				text: 'Sonó un timbre eléctrico. La mujer presionó un interruptor y la música se detuvo.',
			}),
			makeChunk({
				id: 'c4',
				type: 'code',
				text: 'const total = items.reduce((a, b) => a + b, 0);',
			}),
		];

		const prepared = prepareBookDisplayItems(chunks, 10);
		expect(prepared.items.map((item) => item.kind)).toEqual([
			'dialogue',
			'dialogue',
			'para',
			'code',
		]);
	});

	it('merges mid-sentence dialogue continuations split across blocks', () => {
		const chunks: ReadingChunk[] = [
			makeChunk({
				id: 'd1',
				type: 'dialogue',
				page: 4,
				text: '‘Te he llamado antes, madre, pero siempre estabas ocupada o en aislamiento.\nTengo algo especial',
			}),
			makeChunk({
				id: 'd2',
				type: 'dialogue',
				page: 5,
				text: 'que contarte.’',
			}),
		];

		const prepared = prepareBookDisplayItems(chunks, 10);
		expect(prepared.items).toHaveLength(1);
		expect(prepared.items[0]).toMatchObject({
			kind: 'dialogue',
			text: '‘Te he llamado antes, madre, pero siempre estabas ocupada o en aislamiento. Tengo algo especial que contarte.’',
		});
	});
});
