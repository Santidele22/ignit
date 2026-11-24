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
  type PdfStructureScan,
  type PdfStructureStage,
} from './pdf-firewall.structure.js';
import type {
  PdfFirewallReport,
  PdfFirewallVerdict,
  PdfTierReport,
  PdfViolation,
  PdfViolationCode,
} from './pdf-firewall.types.js';

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
/** Checks of each pipeline tier, in execution order (`T2` uses stage ids). */
const TIER_CHECKS: Record<0 | 1 | 2, readonly string[]> = {
  0: ['header', 'polyglot'],
  1: ['active-content', 'encryption'],
  2: [
    'parse',
    'encryption',
    'active-content',
    'external-streams',
    'uris',
    'metadata',
    'resource-limits',
    'page-count',
    'hidden-content',
  ],
};

const TIER_NAMES: Record<0 | 1 | 2, 'header' | 'lexical' | 'structure'> = {
  0: 'header',
  1: 'lexical',
  2: 'structure',
};

/** The violation code each pipeline check reports on. */
const CHECK_CODES: Record<string, PdfViolationCode> = {
  header: 'MISSING_PDF_HEADER',
  polyglot: 'POLYGLOT',
  'active-content': 'ACTIVE_CONTENT_KEY',
  encryption: 'ENCRYPTED',
  parse: 'PARSE_ERROR',
  'external-streams': 'EXTERNAL_STREAM',
  uris: 'SUSPICIOUS_URI',
  metadata: 'SUSPICIOUS_METADATA',
  'resource-limits': 'RESOURCE_LIMIT_EXCEEDED',
  'page-count': 'PAGE_COUNT_OUT_OF_BOUNDS',
  'hidden-content': 'HIDDEN_CONTENT',
};

export async function inspectPdfBuffer(buffer: Buffer): Promise<PdfFirewallVerdict> {
  const report = await runPipeline(buffer);
  return { safe: report.safe, pageCount: report.pageCount, violations: report.violations };
}

/**
 * Same three tiers as `inspectPdfBuffer`, but answering the structured
 * per-tier pipeline report the /admin dashboard visualizes (S1): every tier
 * with its checks marked `passed`, `violation` or `skipped` — exactly one
 * entry per stable check id, tiers always present in order 0, 1, 2.
 */
export async function inspectPdfBufferWithPipeline(buffer: Buffer): Promise<PdfFirewallReport> {
  return runPipeline(buffer);
}

async function runPipeline(buffer: Buffer): Promise<PdfFirewallReport> {
  const tiers: PdfTierReport[] = [];

  // Tier 0 — header sanity and polyglot signatures.
  const headerIndex = findPdfHeader(buffer);
  const tier0Violations: PdfViolation[] = [];
  if (headerIndex < 0) {
    tier0Violations.push({ code: 'MISSING_PDF_HEADER' });
  }
  const polyglot = detectPolyglotSignature(buffer, headerIndex);
  if (polyglot) {
    tier0Violations.push({ code: 'POLYGLOT', detail: polyglot });
  }
  tiers.push(buildTier(0, tier0Violations, true));

  let safe = tier0Violations.length === 0;
  let pageCount = 0;
  let violations = tier0Violations;

  if (safe) {
    // Tier 1 — lexical scan of raw PDF syntax outside strings and streams.
    const tier1Violations: PdfViolation[] = [];
    for (const name of findForbiddenNames(buffer.toString('latin1'))) {
      tier1Violations.push(
        isEncryptionPdfName(name)
          ? { code: 'ENCRYPTED', detail: `/${name}` }
          : { code: 'ACTIVE_CONTENT_KEY', detail: `/${name}` },
      );
    }
    tiers.push(buildTier(1, tier1Violations, true));
    violations = tier1Violations;
    safe = tier1Violations.length === 0;

    if (safe) {
      // Tier 2 — structural walk.
      let scan: PdfStructureScan;
      try {
        scan = await inspectPdfStructure(buffer, firewallLimits());
      } catch (error) {
        scan = {
          pageCount: 0,
          violations: [{ code: 'PARSE_ERROR', detail: describeError(error) }],
          ranStages: [],
        };
      }
      tiers.push(buildTier(2, scan.violations, new Set<string>(scan.ranStages)));
      violations = scan.violations;
      pageCount = scan.pageCount;
      safe = violations.length === 0;
    } else {
      tiers.push(skippedTier(2));
    }
  } else {
    tiers.push(skippedTier(1), skippedTier(2));
  }

  return { schemaVersion: 1, safe, pageCount, violations, tiers };
}

function buildTier(
  index: 0 | 1 | 2,
  violations: readonly PdfViolation[],
  ran: boolean | ReadonlySet<string>,
): PdfTierReport {
  const checkRan = (id: string): boolean => (typeof ran === 'boolean' ? ran : ran.has(id));
  const checks = TIER_CHECKS[index].map((id) => {
    const own = violations.filter((violation) => violation.code === CHECK_CODES[id]);
    return {
      id,
      status: own.length > 0 ? 'violation' : checkRan(id) ? 'passed' : 'skipped',
      violations: own,
    } as const;
  });

  const status = checks.some((check) => check.status === 'violation')
    ? 'violation'
    : typeof ran === 'boolean' && !ran
      ? 'skipped'
      : 'passed';
  return { index, name: TIER_NAMES[index], status, checks };
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

/** Tier 1 and 2 report shape when tier 0 or 1 rejected the file early. */
function skippedTier(index: 0 | 1 | 2): PdfTierReport {
  return {
    index,
    name: TIER_NAMES[index],
    status: 'skipped',
    checks: TIER_CHECKS[index].map((id) => ({ id, status: 'skipped', violations: [] })),
  };
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'el documento no se pudo analizar';
}

async function dropTempFile(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => undefined);
}
