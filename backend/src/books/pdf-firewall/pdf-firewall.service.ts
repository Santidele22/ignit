import { BadRequestException } from '@nestjs/common';
import { readFile, unlink } from 'node:fs/promises';
import { findPdfHeader } from '../pdf.util.js';
import { detectPolyglotSignature, findForbiddenNames } from './pdf-firewall.rules.js';
import { inspectPdfStructure } from './pdf-firewall.structure.js';
import type { PdfFirewallVerdict, PdfViolation } from './pdf-firewall.types.js';

/** Default upper bound for the page count (`MAX_FIREWALL_PAGES`). */
export const DEFAULT_MAX_FIREWALL_PAGES = 2000;

/** Message used when the temp file vanished before the bytes could be read. */
const UNREADABLE_FILE_MESSAGE = 'El archivo subido no se pudo leer para validarlo';

/**
 * The PDF firewall (S1) in three tiers, in order and with early exits:
 *
 * 0. header sanity — `%PDF-1.` inside the first 1024 bytes, no ZIP/HTML/ELF/
 *    Mach-O signature in front of it (the 50 MB size cap is enforced earlier
 *    by multer, so it is not duplicated here);
 * 1. lexical scan of the whole buffer with `#XX` escape normalization — the
 *    names that enable active content, plus `/Encrypt` which makes inspection
 *    impossible;
 * 2. structural walk with `pdf-lib` — parse errors are hostile, the catalog
 *    and every indirect object are checked for the same names, and the page
 *    count must sit between 1 and `MAX_FIREWALL_PAGES`.
 *
 * Tiers 0 and 1 short-circuit on purpose: rejecting before parsing keeps a
 * hostile file from spending CPU inside `pdf-lib`.
 */
export async function inspectPdfBuffer(buffer: Buffer): Promise<PdfFirewallVerdict> {
  const verdict = inspectHeaderSanity(buffer);
  if (verdict) {
    return verdict;
  }

  const lexical = inspectForbiddenNames(buffer);
  if (lexical) {
    return lexical;
  }

  const { pageCount, violations } = await inspectPdfStructure(buffer, maxFirewallPages());
  return { safe: violations.length === 0, pageCount, violations };
}

/**
 * Reads the multer temp file, runs the firewall and answers a `400` with the
 * violation codes when the file is rejected. The temp file is dropped on
 * rejection — the same convention as `assertStoredPdf` — so a refused upload
 * never leaks a file on disk.
 */
export async function assertSafePdfFile(filePath: string): Promise<void> {
  await inspectSafePdfFile(filePath);
}

/**
 * Same check as `assertSafePdfFile`, but answers the accepted verdict so the
 * caller can persist the page count the structural tier measured. A rejected
 * or unreadable file still throws the `400` and drops the temp file.
 */
export async function inspectSafePdfFile(filePath: string): Promise<PdfFirewallVerdict> {
  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch {
    await dropTempFile(filePath);
    throw new BadRequestException(UNREADABLE_FILE_MESSAGE);
  }

  const verdict = await inspectPdfBuffer(buffer);
  if (verdict.safe) {
    return verdict;
  }

  await dropTempFile(filePath);
  throw new BadRequestException(firewallRejectionMessage(verdict.violations));
}

/** Spanish `400` message naming every violation, e.g. `ACTIVE_CONTENT_KEY /JavaScript`. */
export function firewallRejectionMessage(violations: PdfViolation[]): string {
  const reasons = violations.map((violation) =>
    violation.detail ? `${violation.code} ${violation.detail}` : violation.code,
  );
  return `El PDF fue rechazado por el filtro de seguridad: ${reasons.join(', ')}. Eliminá el contenido activo y volvé a subirlo.`;
}

/** `MAX_FIREWALL_PAGES`, defaulting to 2000 when unset or not a positive integer. */
export function maxFirewallPages(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.MAX_FIREWALL_PAGES ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_FIREWALL_PAGES;
}

/** Tier 0; `null` means the file may continue to the next tier. */
function inspectHeaderSanity(buffer: Buffer): PdfFirewallVerdict | null {
  const headerIndex = findPdfHeader(buffer);
  const violations: PdfViolation[] = [];

  if (headerIndex < 0) {
    violations.push({ code: 'MISSING_PDF_HEADER' });
  }

  const polyglot = detectPolyglotSignature(buffer, headerIndex);
  if (polyglot) {
    violations.push({ code: 'POLYGLOT', detail: polyglot });
  }

  return violations.length === 0
    ? null
    : { safe: false, pageCount: 0, violations };
}

/** Tier 1; `null` means the file may continue to the structural tier. */
function inspectForbiddenNames(buffer: Buffer): PdfFirewallVerdict | null {
  const names = findForbiddenNames(buffer.toString('latin1'));
  if (names.length === 0) {
    return null;
  }

  const violations: PdfViolation[] = [];
  if (names.includes('Encrypt')) {
    violations.push({ code: 'ENCRYPTED', detail: '/Encrypt' });
  }
  for (const name of names) {
    if (name === 'Encrypt') continue;
    violations.push({ code: 'ACTIVE_CONTENT_KEY', detail: `/${name}` });
  }

  return { safe: false, pageCount: 0, violations };
}

async function dropTempFile(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => undefined);
}
