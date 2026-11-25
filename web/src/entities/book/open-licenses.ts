/**
 * Canonical open licenses eligible for Ignit's public catalog.
 * Mirrors `backend/src/books/lib/open-licenses.ts`.
 */
export const OPEN_LICENSE_OPTIONS = [
	'Dominio público',
	'CC0 1.0',
	'CC BY 4.0',
	'CC BY-SA 4.0',
	'CC BY-NC 4.0',
	'CC BY-NC-SA 4.0',
	'CC BY-ND 4.0',
	'CC BY-NC-ND 4.0',
	'Licencia Open Source (MIT / Apache / GPL / BSD)',
	'Documentación libre (GFDL / Open Docs)',
] as const;

export type OpenLicenseOption = (typeof OPEN_LICENSE_OPTIONS)[number];

export const OPEN_LICENSE_REQUIRED_MESSAGE =
	'El catálogo público solo admite obras en dominio público o con licencias abiertas (Creative Commons, Open Source, documentación libre).';

const CANONICAL_SET = new Set(OPEN_LICENSE_OPTIONS.map((item) => item.toLowerCase()));

const OPEN_LICENSE_PATTERNS: readonly RegExp[] = [
	/^dominio\s+p[uú]blico$/i,
	/^public\s+domain$/i,
	/^cc0(\s+\d+(\.\d+)?)?$/i,
	/^cc\s+by(-(sa|nc|nd|nc-sa|nc-nd))?(\s+\d+(\.\d+)?)?$/i,
	/^creative\s+commons(\s+(zero|cc0|by(-(sa|nc|nd|nc-sa|nc-nd))?|attribution(-(sharealike|noncommercial|noderivatives))*)(\s+\d+(\.\d+)?)?)?$/i,
	/^(mit|apache(\s+2\.0|-2\.0)?|gpl([\s-]*v?[23](\.0)?)?|lgpl([\s-]*v?[23](\.0)?)?|agpl([\s-]*v?3(\.0)?)?|bsd(-\d-clause)?|mpl(\s+2\.0|-2\.0)?|isc|unlicense)(\s+license)?$/i,
	/^(gfdl|gnu\s+fdl)(\s+\d+(\.\d+)?)?$/i,
	/^licencia\s+open\s+source$/i,
	/^open\s+source(\s+license)?$/i,
	/^documentaci[oó]n\s+libre$/i,
];

export function isOpenLicense(license: string | null | undefined): boolean {
	if (typeof license !== 'string') return false;
	const normalized = license.trim().replace(/\s+/g, ' ');
	if (normalized.length === 0) return false;
	if (CANONICAL_SET.has(normalized.toLowerCase())) return true;
	return OPEN_LICENSE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Compact badge label for catalog cards (keeps cards clean and scannable). */
export function formatLicenseBadge(license: string | null | undefined): string | null {
	if (typeof license !== 'string') return null;
	const trimmed = license.trim();
	if (!trimmed) return null;
	if (/^licencia\s+open\s+source\b/i.test(trimmed)) return 'Open Source';
	if (/^documentaci[oó]n\s+libre\b/i.test(trimmed)) return 'Docs libres';
	return trimmed.length > 24 ? `${trimmed.slice(0, 23)}…` : trimmed;
}
