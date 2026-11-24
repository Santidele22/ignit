/**
 * View helpers of the /admin security pipeline (S4) and the LLM style
 * reference (S6). Pure functions only: the backend answers the stored
 * `PdfFirewallReport` sidecar verbatim and this module turns it into labels,
 * tones and a one-line summary the queue rows can render.
 */
export type FirewallViolation = {
	code: string;
	detail?: string;
};

export type FirewallCheck = {
	id: string;
	status: 'passed' | 'violation' | 'skipped';
	violations: FirewallViolation[];
};

export type FirewallTier = {
	index: number;
	name: 'header' | 'lexical' | 'structure';
	status: 'passed' | 'violation' | 'skipped';
	checks: FirewallCheck[];
};

export type FirewallReport = {
	schemaVersion: number;
	safe: boolean;
	pageCount: number;
	violations: FirewallViolation[];
	tiers: FirewallTier[];
};

/** Spanish labels of the three deterministic tiers. */
export const FIREWALL_TIER_LABELS: Record<FirewallTier['name'], string> = {
	header: 'Tier 0 · Encabezado',
	lexical: 'Tier 1 · Escaneo léxico',
	structure: 'Tier 2 · Estructura',
};

/** Spanish labels of the stable check ids the backend emits. */
export const FIREWALL_CHECK_LABELS: Record<string, string> = {
	header: 'Encabezado %PDF',
	polyglot: 'Firma polígota',
	'active-content': 'Contenido activo',
	encryption: 'Cifrado',
	parse: 'Parseo estructural',
	'external-streams': 'Streams externos',
	uris: 'Enlaces /URI',
	metadata: 'Metadatos',
	'resource-limits': 'Límites de recursos',
	'page-count': 'Cantidad de páginas',
	'hidden-content': 'Contenido oculto',
};

/** Tone for `data-tone`: a pass is `ok`; findings and skips keep their name. */
export function firewallTone(status: FirewallCheck['status']): 'ok' | 'violation' | 'skipped' {
	return status === 'passed' ? 'ok' : status;
}

/** Spanish label of one tier name; unknown names degrade gracefully. */
export function firewallTierLabel(name: FirewallTier['name']): string {
	return FIREWALL_TIER_LABELS[name] ?? name;
}

/** Spanish label of one check id; unknown ids degrade to the raw id. */
export function firewallCheckLabel(id: string): string {
	return FIREWALL_CHECK_LABELS[id] ?? id;
}

/** `GET /admin/books/:id/firewall` */ export function firewallRoute(id: number): string {
	return `/admin/books/${id}/firewall`;
}

/** `GET /admin/ai/style-reference` */
export function styleReferenceRoute(): string {
	return '/admin/ai/style-reference';
}

export type FirewallSummary = {
	verdict: 'ok' | 'rejected';
	pageCount: number;
	violationCount: number;
	failedTier: string | null;
};

/** One-line summary of the report: verdict, page count and the failing tier. */
export function summarizeFirewallReport(report: FirewallReport | null | undefined): FirewallSummary {
	if (!report || report.tiers.length === 0) {
		return { verdict: 'rejected', pageCount: 0, violationCount: 0, failedTier: null };
	}

	const failedTier = report.tiers.find((tier) => tier.status === 'violation');

	return {
		verdict: report.safe ? 'ok' : 'rejected',
		pageCount: report.pageCount,
		violationCount: report.violations.length,
		failedTier: failedTier ? firewallTierLabel(failedTier.name) : null,
	};
}
