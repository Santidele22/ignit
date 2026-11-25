/**
 * Canonical open licenses allowed in Ignit's public catalog.
 *
 * Private user uploads (`published = false`) may omit a license so readers can
 * still upload personal PDFs for private Modo Vigilia reading. Public catalog
 * entries (`published = true`) MUST carry a recognized open license or public
 * domain designation and pass admin approval.
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

export const ADMIN_APPROVAL_REQUIRED_MESSAGE =
  'Solo un administrador puede publicar un libro en el catálogo público tras aprobar su revisión y licencia abierta.';

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

/**
 * Returns `true` only when the given license string identifies a recognized
 * public-domain or open license eligible for Ignit's public catalog.
 */
export function isOpenLicense(license: string | null | undefined): boolean {
  if (typeof license !== 'string') return false;
  const normalized = license.trim().replace(/\s+/g, ' ');
  if (normalized.length === 0) return false;
  if (CANONICAL_SET.has(normalized.toLowerCase())) return true;
  return OPEN_LICENSE_PATTERNS.some((pattern) => pattern.test(normalized));
}
