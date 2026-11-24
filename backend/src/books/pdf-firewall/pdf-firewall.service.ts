import { BadRequestException } from '@nestjs/common';
import { readFile, unlink } from 'node:fs/promises';
import { findPdfHeader } from '../pdf.util.js';
import {
  detectPolyglotSignature,
  findForbiddenNames,
  isEncryptionPdfName,
} from './pdf-firewall.rules.js';
import {
  DEFAULT_MAX_STREAM_BYTES,
  DEFAULT_MAX_TOTAL_STREAM_BYTES,
} from './pdf-firewall.streams.js';
import {
  DEFAULT_MAX_FIREWALL_OBJECTS,
  inspectPdfStructure,
  type PdfStructureLimits,
} from './pdf-firewall.structure.js';
import type { PdfFirewallVerdict, PdfViolation } from './pdf-firewall.types.js';

/** Default upper bound for the page count (`MAX_FIREWALL_PAGES`). */
export const DEFAULT_MAX_FIREWALL_PAGES = 2000;

/** Message used when the temp file vanished before the bytes could be read. */
const UNREADABLE_FILE_MESSAGE = 'El archivo subido no se pudo leer para validarlo';

/**
 * The PDF firewall (S1 + hardened rules) in three tiers, in order and with
 * early exits:
 *
 * 0. header sanity — `%PDF-1.[0-7]` or `%PDF-2.0` inside the first 1024 bytes,
 *    no executable/archive/script/HTML polyglot signature in front of it;
 * 1. lexical scan of the whole buffer with `#XX` escape normalization — active
 *    actions, embedded files, multimedia, external proxies and encryption keys;
 * 2. structural walk with `pdf-lib` — parse errors are hostile, indirect object
 *    count, nesting depth and Flate decompression bounds are enforced, links
 *    (`/URI`), metadata (`/Info`, XMP), contextual actions (`/Screen`, `/Hide`,
 *    interactive `/AcroForm`), external streams (`/F`) and hidden-text tricks
 *    (`<1pt`, `3 Tr` without OCR image, white-on-white) are inspected.
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

  const { pageCount, violations } = await inspectPdfStructure(buffer, firewallLimits());
  return { safe: violations.length === 0, pageCount, violations };
}

/**
 * Reads the multer temp file, runs the firewall and answers a `400` with the
 * violation codes when the file is rejected. The temp file is dropped on
 * rejection so a refused upload never leaks a file on disk.
 */
export async function assertSafePdfFile(filePath: string): Promise<void> {
  await inspectSafePdfFile(filePath);
}

/**
 * Same check as `assertSafePdfFile`, but answers the accepted verdict so the
 * caller can persist the page count the structural tier measured.
 */
export async function inspectSafePdfFile(filePath: string): Promise<PdfFirewallVerdict> {
  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch {
    await dropTempFile(filePath);
    throw new BadRequestException(UNREADABLE_FILE_MESSAGE);
  }

  let verdict: PdfFirewallVerdict;
  try {
    verdict = await inspectPdfBuffer(buffer);
  } catch (error) {
    await dropTempFile(filePath);
    const detail = error instanceof Error ? error.message : 'el documento no se pudo analizar';
    throw new BadRequestException(
      firewallRejectionMessage([{ code: 'PARSE_ERROR', detail }]),
    );
  }
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
  return positiveIntEnv(env.MAX_FIREWALL_PAGES, DEFAULT_MAX_FIREWALL_PAGES);
}

export function firewallLimits(env: NodeJS.ProcessEnv = process.env): PdfStructureLimits {
  return {
    maxPages: maxFirewallPages(env),
    maxObjects: positiveIntEnv(env.MAX_FIREWALL_OBJECTS, DEFAULT_MAX_FIREWALL_OBJECTS),
    maxStreamBytes: positiveIntEnv(env.MAX_FIREWALL_STREAM_BYTES, DEFAULT_MAX_STREAM_BYTES),
    maxTotalStreamBytes: positiveIntEnv(
      env.MAX_FIREWALL_TOTAL_STREAM_BYTES,
      DEFAULT_MAX_TOTAL_STREAM_BYTES,
    ),
  };
}

function positiveIntEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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
  for (const name of names) {
    if (isEncryptionPdfName(name)) {
      violations.push({ code: 'ENCRYPTED', detail: `/${name}` });
    } else {
      violations.push({ code: 'ACTIVE_CONTENT_KEY', detail: `/${name}` });
    }
  }

  return { safe: false, pageCount: 0, violations };
}

async function dropTempFile(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => undefined);
}
