import { describe, expect, it } from 'vitest';
import {
	adminAiVerdict,
	adminKindLabel,
	adminQueuePageCount,
	adminQueueWindow,
	formatAdminFileSize,
	formatAdminRelativeTime,
} from './admin-queue';

describe('admin queue view helpers (S5)', () => {
	it('formats the stored byte size as KB or MB', () => {
		expect(formatAdminFileSize(null)).toBe('sin archivo');
		expect(formatAdminFileSize('')).toBe('sin archivo');
		expect(formatAdminFileSize('0')).toBe('sin archivo');
		expect(formatAdminFileSize('1024')).toBe('1 KB');
		expect(formatAdminFileSize('834567')).toBe('815 KB');
		expect(formatAdminFileSize(String(2 * 1024 * 1024))).toBe('2.0 MB');
		expect(formatAdminFileSize(String(Math.round(1.4 * 1024 * 1024)))).toBe('1.4 MB');
		expect(formatAdminFileSize('no-es-un-numero')).toBe('sin archivo');
	});

	it('formats createdAt as a relative age', () => {
		const now = Date.parse('2026-02-10T12:00:00.000Z');
		expect(formatAdminRelativeTime('2026-02-10T11:59:40.000Z', now)).toBe('recién');
		expect(formatAdminRelativeTime('2026-02-10T11:35:00.000Z', now)).toBe('hace 25 min');
		expect(formatAdminRelativeTime('2026-02-10T07:00:00.000Z', now)).toBe('hace 5 h');
		expect(formatAdminRelativeTime('2026-02-07T12:00:00.000Z', now)).toBe('hace 3 d');
		expect(formatAdminRelativeTime(null, now)).toBe('sin fecha');
		expect(formatAdminRelativeTime('no-es-fecha', now)).toBe('sin fecha');
	});

	it('labels the kind of every queued upload', () => {
		expect(adminKindLabel('tecnico')).toBe('Técnico');
		expect(adminKindLabel('filosofia')).toBe('Filosofía y Ensayo');
		expect(adminKindLabel('no_tecnico')).toBe('General');
	});

	it('maps the AI columns to ok / suspect / skipped with quality and notes', () => {
		expect(adminAiVerdict({ aiSafety: 'ok', aiQuality: 4, aiNotes: 'Buen texto.', aiStatus: 'ok' })).toEqual({
			tone: 'ok',
			label: 'IA: ok',
			qualityLabel: 'Calidad 4/5',
			notes: 'Buen texto.',
		});

		expect(adminAiVerdict({ aiSafety: 'suspect', aiQuality: 1, aiNotes: 'Spam.', aiStatus: 'suspect' })).toEqual({
			tone: 'suspect',
			label: 'IA: sospechoso',
			qualityLabel: 'Calidad 1/5',
			notes: 'Spam.',
		});

		expect(adminAiVerdict({ aiSafety: null, aiQuality: null, aiNotes: null, aiStatus: 'skipped' })).toEqual({
			tone: 'skipped',
			label: 'IA: sin analizar',
			qualityLabel: null,
			notes: null,
		});

		// Fail-open rows from before the AI stage existed carry no status at all.
		expect(adminAiVerdict({ aiSafety: null, aiQuality: null, aiNotes: null, aiStatus: null }).tone).toBe('skipped');
		// Out-of-range quality never renders a fake rating.
		expect(
			adminAiVerdict({ aiSafety: 'ok', aiQuality: 9, aiNotes: '   ', aiStatus: 'ok' }),
		).toEqual({ tone: 'ok', label: 'IA: ok', qualityLabel: null, notes: null });
	});

	it('derives the pagination window from total and limit', () => {
		expect(adminQueueWindow({ total: 0, offset: 0, limit: 20 })).toEqual({
			pageCount: 1,
			page: 1,
			hasPrev: false,
			hasNext: false,
			rangeLabel: '0 PDFs',
		});

		expect(adminQueueWindow({ total: 42, offset: 20, limit: 20 })).toEqual({
			pageCount: 3,
			page: 2,
			hasPrev: true,
			hasNext: true,
			rangeLabel: '21–40 de 42 PDFs',
		});

		expect(adminQueueWindow({ total: 42, offset: 40, limit: 20 })).toMatchObject({
			pageCount: 3,
			page: 3,
			hasPrev: true,
			hasNext: false,
			rangeLabel: '41–42 de 42 PDFs',
		});

		expect(adminQueuePageCount(1, 20)).toBe(1);
		expect(adminQueuePageCount(21, 20)).toBe(2);
	});
});
