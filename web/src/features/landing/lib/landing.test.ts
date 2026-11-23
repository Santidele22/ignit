import { describe, expect, it } from 'vitest';

import type { Book } from '../../../entities/book/types';
import {
	bookSizeKb,
	buildShelfLayout,
	computeOfflineMeter,
	coverVariantIndex,
	filterCatalogBooks,
	formatSizeKb,
	kindLabel,
	normalizeSearchText,
	parseFileSizeBytes,
} from './catalog';
import { defaultEmbedPath, resolveSafeReaderEmbedPath } from './embed';
import {
	createInitialJourneyState,
	setJourneyOffline,
	stepJourneyPage,
} from './journey';
import { PIPELINE_STEPS, pipelineCaptionForStep } from './pipeline';

const SAMPLE_BOOKS: Book[] = [
	{
		id: 4,
		title: 'El desierto de los tártaros',
		author: 'Dino Buzzati',
		description: 'La fortaleza Bastiani frente a la llanura.',
		status: 'reading',
		statusLabel: 'Leyendo',
		kind: 'no_tecnico',
		published: true,
		hasFile: true,
		fileSizeBytes: 579_584, // 566 KB
	},
	{
		id: 5,
		title: 'Sistemas operativos modernos',
		author: 'Andrew S. Tanenbaum',
		description: 'Kernel, procesos y memoria virtual.',
		status: 'queued',
		statusLabel: 'En cola',
		kind: 'tecnico',
		published: true,
		hasFile: true,
		fileSizeBytes: 1_515_520, // 1480 KB -> 1.4 MB
	},
	{
		id: 6,
		title: 'El elogio de la sombra',
		author: 'Junichiro Tanizaki',
		description: 'Estética de la penumbra.',
		status: 'finished',
		statusLabel: 'Terminado',
		kind: 'no_tecnico',
		published: true,
		hasFile: true,
	},
];

describe('landing catalog helpers', () => {
	it('parses fileSizeBytes safely and formats KB/MB consistently', () => {
		expect(parseFileSizeBytes('579584')).toBe(579584);
		expect(parseFileSizeBytes(1024)).toBe(1024);
		expect(parseFileSizeBytes('0')).toBeUndefined();
		expect(parseFileSizeBytes('-50')).toBeUndefined();
		expect(parseFileSizeBytes('abc')).toBeUndefined();
		expect(parseFileSizeBytes(null)).toBeUndefined();

		expect(bookSizeKb(SAMPLE_BOOKS[0])).toBe(566);
		expect(bookSizeKb(SAMPLE_BOOKS[1])).toBe(1480);
		expect(bookSizeKb(SAMPLE_BOOKS[2])).toBeGreaterThanOrEqual(160);
		expect(bookSizeKb(SAMPLE_BOOKS[2])).toBeLessThanOrEqual(600);

		expect(formatSizeKb(0)).toBe('0 KB');
		expect(formatSizeKb(566)).toBe('566 KB');
		expect(formatSizeKb(1480)).toBe('1.4 MB');
	});

	it('normalizes accents and filters by BookKind and query', () => {
		expect(normalizeSearchText('El desierto de los tártaros')).toBe(
			'el desierto de los tartaros',
		);
		expect(kindLabel('tecnico')).toBe('Técnico');
		expect(kindLabel('no_tecnico')).toBe('No técnico');

		expect(filterCatalogBooks(SAMPLE_BOOKS, '*', '')).toHaveLength(3);
		expect(filterCatalogBooks(SAMPLE_BOOKS, 'tecnico', '')).toEqual([SAMPLE_BOOKS[1]]);
		expect(filterCatalogBooks(SAMPLE_BOOKS, 'no_tecnico', '')).toHaveLength(2);
		expect(filterCatalogBooks(SAMPLE_BOOKS, '*', 'tartaros')).toEqual([SAMPLE_BOOKS[0]]);
		expect(filterCatalogBooks(SAMPLE_BOOKS, 'tecnico', 'tanenbaum')).toEqual([
			SAMPLE_BOOKS[1],
		]);
		expect(filterCatalogBooks(SAMPLE_BOOKS, 'no_tecnico', 'tanenbaum')).toEqual([]);
	});

	it('computes offline preview meter summary and progress width', () => {
		expect(computeOfflineMeter([])).toEqual({
			count: 0,
			totalKb: 0,
			label: '0 libros · 0 KB',
			barPercent: 0,
		});
		expect(computeOfflineMeter([566])).toEqual({
			count: 1,
			totalKb: 566,
			label: '1 libro · 566 KB',
			barPercent: 13,
		});
		expect(computeOfflineMeter([566, 1480])).toEqual({
			count: 2,
			totalKb: 2046,
			label: '2 libros · 2.0 MB',
			barPercent: 49,
		});
		expect(computeOfflineMeter([9000]).barPercent).toBe(100);
	});

	it('builds interactive 3-shelf layout from real books and clean fallback when empty', () => {
		const populated = buildShelfLayout(SAMPLE_BOOKS);
		expect(populated.shelves).toHaveLength(3);
		const interactiveSpines = populated.shelves
			.flatMap((s) => s.items)
			.filter((it) => 'book' in it && it.book !== undefined);
		expect(interactiveSpines).toHaveLength(3);
		expect(populated.defaultHud.title).toContain('El desierto de los tártaros');
		expect(populated.isFallback).toBe(false);

		const empty = buildShelfLayout([]);
		expect(empty.shelves).toHaveLength(3);
		expect(empty.isFallback).toBe(true);
		expect(empty.defaultHud.title).toContain('Catálogo listo');
	});

	it('maps any book id to a deterministic cover variant in 0..7', () => {
		for (let id = 1; id <= 24; id++) {
			const v = coverVariantIndex(id);
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThanOrEqual(7);
		}
		expect(coverVariantIndex(4)).toBe(coverVariantIndex(4));
	});
});

describe('landing reader embed URL validation', () => {
	const origin = 'https://ignit.ignit677.workers.dev';

	it('resolves valid same-origin reader paths and numeric IDs', () => {
		expect(resolveSafeReaderEmbedPath('/lecturas/4', origin)).toBe('/lecturas/4');
		expect(resolveSafeReaderEmbedPath('/lecturas/42/', origin)).toBe('/lecturas/42');
		expect(resolveSafeReaderEmbedPath('4', origin)).toBe('/lecturas/4');
		expect(resolveSafeReaderEmbedPath(`${origin}/lecturas/7`, origin)).toBe(
			'/lecturas/7',
		);
	});

	it('rejects external origins, unsafe schemes, and non-reader routes', () => {
		expect(resolveSafeReaderEmbedPath('https://evil.example/lecturas/4', origin)).toBeNull();
		expect(resolveSafeReaderEmbedPath('//evil.example/lecturas/4', origin)).toBeNull();
		expect(resolveSafeReaderEmbedPath('javascript:alert(1)', origin)).toBeNull();
		expect(resolveSafeReaderEmbedPath('data:text/html,hi', origin)).toBeNull();
		expect(resolveSafeReaderEmbedPath('/login', origin)).toBeNull();
		expect(resolveSafeReaderEmbedPath('/biblioteca', origin)).toBeNull();
		expect(resolveSafeReaderEmbedPath('/lecturas/4/extra', origin)).toBeNull();
		expect(resolveSafeReaderEmbedPath('', origin)).toBeNull();
	});

	it('rejects relative dot-segment traversal, encoded traversal, scheme mismatches, and non-positive IDs (S6)', () => {
		const invalidInputs = [
			'/lecturas/..',
			'/lecturas/.',
			'/lecturas/../',
			'/lecturas/./',
			'/lecturas/%2e%2e',
			'/lecturas/%2e',
			'/lecturas/%2E%2E',
			'0',
			'-1',
			'http://ignit.ignit677.workers.dev/lecturas/4',
			'https://ignit.ignit677.workers.dev.evil.com/lecturas/4',
			'https://ignit.ignit677.workers.dev@evil.com/lecturas/4',
			'//ignit.ignit677.workers.dev/lecturas/4',
			'/\\evil.example/lecturas/4',
			'JAVASCRIPT:alert(1)',
			'blob:https://ignit.ignit677.workers.dev/lecturas/4',
			'https://ignit.ignit677.workers.dev/lecturas/..',
		];

		for (const input of invalidInputs) {
			expect(
				resolveSafeReaderEmbedPath(input, origin),
				`input=${JSON.stringify(input)}`,
			).toBeNull();
		}

		expect(resolveSafeReaderEmbedPath('/lecturas/4?foo=1#bar', origin)).toBe('/lecturas/4');
		expect(resolveSafeReaderEmbedPath(`${origin}/lecturas/4?foo=1#bar`, origin)).toBe(
			'/lecturas/4',
		);
	});

	it('picks the first published book for default embed path or null when empty', () => {
		expect(defaultEmbedPath(SAMPLE_BOOKS)).toBe('/lecturas/4');
		expect(defaultEmbedPath([])).toBeNull();
		expect(defaultEmbedPath([{ id: 0, published: true }])).toBeNull();
	});
});

describe('landing Desktop <-> Phone PWA journey simulator', () => {
	it('keeps desktop and phone synchronized while online', () => {
		const initial = createInitialJourneyState();
		expect(initial.offline).toBe(false);
		expect(initial.phonePage).toBe(98);
		expect(initial.deskPage).toBe(98);
		expect(initial.pending).toBe(0);
		expect(initial.syncTag).toBe('sync activo');

		const next = stepJourneyPage(initial, 1);
		expect(next.phonePage).toBe(99);
		expect(next.deskPage).toBe(99);
		expect(next.pending).toBe(0);
	});

	it('queues phone page changes while offline and reconciles desktop upon reconnecting', () => {
		const initial = createInitialJourneyState();
		const offline = setJourneyOffline(initial, true);
		expect(offline.offline).toBe(true);
		expect(offline.syncTag).toBe('sin red · en cola');

		const stepped1 = stepJourneyPage(offline, 1);
		const stepped2 = stepJourneyPage(stepped1, 1);
		expect(stepped2.phonePage).toBe(100);
		expect(stepped2.deskPage).toBe(98);
		expect(stepped2.pending).toBe(2);
		expect(stepped2.phoneQueueLabel).toBe('2 cambios locales');

		const reconnected = setJourneyOffline(stepped2, false);
		expect(reconnected.offline).toBe(false);
		expect(reconnected.deskPage).toBe(100);
		expect(reconnected.pending).toBe(0);
		expect(reconnected.phoneQueueLabel).toBe('al día ✓');
	});

	it('clamps page navigation within bounds', () => {
		const initial = createInitialJourneyState();
		let state = initial;
		for (let i = 0; i < 10; i++) {
			state = stepJourneyPage(state, -1);
		}
		expect(state.phonePage).toBe(96);
	});
});

describe('landing pipeline steps', () => {
	it('exposes the four curated publication stages and captions', () => {
		expect(PIPELINE_STEPS).toHaveLength(4);
		expect(PIPELINE_STEPS.map((s) => s.step)).toEqual(['1', '2', '3', '4']);
		expect(pipelineCaptionForStep('1')).toContain('standby');
		expect(pipelineCaptionForStep('4')).toContain('catálogo');
		expect(pipelineCaptionForStep('99')).toBe(pipelineCaptionForStep('1'));
	});
});
