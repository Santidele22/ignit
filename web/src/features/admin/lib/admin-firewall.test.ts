import { describe, expect, it } from 'vitest';
import {
	firewallCheckLabel,
	firewallRoute,
	firewallTierLabel,
	firewallTone,
	styleReferenceRoute,
	summarizeFirewallReport,
	type FirewallReport,
} from './admin-firewall';

const cleanReport: FirewallReport = {
	schemaVersion: 1,
	safe: true,
	pageCount: 4,
	violations: [],
	tiers: [
		{
			index: 0,
			name: 'header',
			status: 'passed',
			checks: [
				{ id: 'header', status: 'passed', violations: [] },
				{ id: 'polyglot', status: 'passed', violations: [] },
			],
		},
		{
			index: 1,
			name: 'lexical',
			status: 'passed',
			checks: [
				{ id: 'active-content', status: 'passed', violations: [] },
				{ id: 'encryption', status: 'passed', violations: [] },
			],
		},
		{
			index: 2,
			name: 'structure',
			status: 'passed',
			checks: [
				{ id: 'parse', status: 'passed', violations: [] },
				{ id: 'encryption', status: 'passed', violations: [] },
				{ id: 'active-content', status: 'passed', violations: [] },
				{ id: 'external-streams', status: 'passed', violations: [] },
				{ id: 'uris', status: 'passed', violations: [] },
				{ id: 'metadata', status: 'passed', violations: [] },
				{ id: 'resource-limits', status: 'passed', violations: [] },
				{ id: 'page-count', status: 'passed', violations: [] },
				{ id: 'hidden-content', status: 'passed', violations: [] },
			],
		},
	],
};

describe('firewall report helpers (S4)', () => {
	it('labels the three tiers in Spanish', () => {
		expect(firewallTierLabel('header')).toBe('Tier 0 · Encabezado');
		expect(firewallTierLabel('lexical')).toBe('Tier 1 · Escaneo léxico');
		expect(firewallTierLabel('structure')).toBe('Tier 2 · Estructura');
	});

	it('routes the report endpoint per book id', () => {
		expect(firewallRoute(7)).toBe('/admin/books/7/firewall');
	});

	it('routes the style reference endpoint', () => {
		expect(styleReferenceRoute()).toBe('/admin/ai/style-reference');
	});

	it('summarizes a clean report as all tiers passed', () => {
		const summary = summarizeFirewallReport(cleanReport);

		expect(summary).toEqual({
			verdict: 'ok',
			pageCount: 4,
			violationCount: 0,
			failedTier: null,
		});
	});

	it('summarizes a rejection by its first failing tier', () => {
		const report: FirewallReport = {
			schemaVersion: 1,
			safe: false,
			pageCount: 0,
			violations: [{ code: 'ACTIVE_CONTENT_KEY', detail: '/JavaScript' }],
			tiers: [
				{
					...cleanReport.tiers[0],
					status: 'passed',
				},
				{
					...cleanReport.tiers[1],
					status: 'violation',
					checks: [
						{
							id: 'active-content',
							status: 'violation',
							violations: [{ code: 'ACTIVE_CONTENT_KEY', detail: '/JavaScript' }],
						},
						{ id: 'encryption', status: 'passed', violations: [] },
					],
				},
				{ ...cleanReport.tiers[2], status: 'skipped' },
			],
		};

		const summary = summarizeFirewallReport(report);

		expect(summary.verdict).toBe('rejected');
		expect(summary.violationCount).toBe(1);
		expect(summary.failedTier).toEqual(firewallTierLabel('lexical'));
	});

	it('maps every check status to a tone, with Spanish labels', () => {
		expect(firewallTone('passed')).toBe('ok');
		expect(firewallTone('violation')).toBe('violation');
		expect(firewallTone('skipped')).toBe('skipped');
		// Unknown ids degrade to the raw id, never an empty cell.
		expect(firewallCheckLabel('future-check')).toBe('future-check');
		expect(firewallCheckLabel('uris')).toBe('Enlaces /URI');
	});
});
