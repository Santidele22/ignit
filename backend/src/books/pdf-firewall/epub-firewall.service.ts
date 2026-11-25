import JSZip from 'jszip';
import {
  isPathTraversalEntry,
  parseZipCentralDirectory,
  ZipBoundsError,
  type ZipEntry,
} from './epub-firewall.zip.js';
import type {
  EpubCheckStatus,
  EpubFirewallReport,
  EpubFirewallVerdict,
  EpubTierReport,
  EpubViolation,
} from './epub-firewall.types.js';

/** Default upper bound for ZIP entry count (`MAX_EPUB_ENTRIES`). */
export const DEFAULT_MAX_EPUB_ENTRIES = 10_000;
/** Default decompressed-bytes budget across all entries (`MAX_EPUB_TOTAL_UNCOMPRESSED_BYTES`). */
export const DEFAULT_MAX_EPUB_TOTAL_BYTES = 256 * 1024 * 1024;
/** Single-entry soft cap: larger text documents are not content-scanned. */
export const DEFAULT_MAX_EPUB_SCAN_DOC_BYTES = 16 * 1024 * 1024;
/** Uncompressed/compressed ratio above which a single entry is a bomb. */
export const MAX_EPUB_COMPRESSION_RATIO = 200;

const EPUB_MIMETYPE = 'application/epub+zip';
const TEXT_DOC_EXTENSIONS = new Set([
  '.xhtml',
  '.xht',
  '.html',
  '.htm',
  '.xml',
  '.opf',
  '.ncx',
  '.svg',
]);

const TIER_CHECKS: Record<0 | 1 | 2, readonly string[]> = {
  0: ['zip', 'mimetype', 'path-traversal', 'entry-limits', 'compression-ratio'],
  1: ['container', 'opf', 'drm'],
  2: ['xxe', 'active-content', 'uris', 'remote-resources'],
};

const TIER_NAMES: Record<0 | 1 | 2, EpubTierReport['name']> = {
  0: 'zip',
  1: 'container',
  2: 'content',
};

/** The violation code each pipeline check reports on. */
const CHECK_CODES: Record<string, string> = {
  zip: 'MISSING_EPUB_ZIP',
  mimetype: 'MISSING_EPUB_MIMETYPE',
  'path-traversal': 'PATH_TRAVERSAL',
  'entry-limits': 'EPUB_ENTRY_LIMIT_EXCEEDED',
  'compression-ratio': 'EPUB_ZIP_BOMB',
  container: 'MISSING_CONTAINER_XML',
  opf: 'MISSING_OPF',
  drm: 'DRM_ENCRYPTED',
  xxe: 'XXE_ENTITY',
  'active-content': 'ACTIVE_CONTENT',
  uris: 'SUSPICIOUS_URI',
  'remote-resources': 'REMOTE_RESOURCE',
};

type EpubFirewallLimits = {
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  maxScanDocBytes: number;
};

/** Engine limits from env, defaulting for unset / non-positive values. */
export function epubFirewallLimits(env: NodeJS.ProcessEnv = process.env): EpubFirewallLimits {
  return {
    maxEntries: positiveIntEnv(env.MAX_EPUB_ENTRIES, DEFAULT_MAX_EPUB_ENTRIES),
    maxTotalUncompressedBytes: positiveIntEnv(
      env.MAX_EPUB_TOTAL_UNCOMPRESSED_BYTES,
      DEFAULT_MAX_EPUB_TOTAL_BYTES,
    ),
    maxScanDocBytes: positiveIntEnv(env.MAX_EPUB_SCAN_DOC_BYTES, DEFAULT_MAX_EPUB_SCAN_DOC_BYTES),
  };
}

function positiveIntEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function inspectEpubBuffer(buffer: Buffer): Promise<EpubFirewallVerdict> {
  const report = await runPipeline(buffer);
  return {
    safe: report.safe,
    spineDocumentCount: report.pageCount,
    violations: report.violations,
  };
}

/**
 * The EPUB firewall (S4) in three tiers, in order and with early exits:
 *
 * 0. ZIP sanity — `PK\x03\x04` signature, first `mimetype` entry reading
 *    `application/epub+zip`, no path-traversal entry names, entry-count and
 *    decompressed-byte bounds (anti zip-bomb), per-entry compression ratio.
 *    Parsed straight from the central directory, never decompressing anything
 *    before the reported sizes are validated;
 * 1. container sanity — `META-INF/container.xml` resolving to a readable OPF
 *    package with a spine, and no DRM `META-INF/encryption.xml`;
 * 2. content scan — every text document checked for XXE entities, active
 *    content (`<script>`, `<iframe>`, `<object>`, `<embed>`, `on*=` handlers),
 *    `javascript:`/`file:` URIs and remote or `data:` embedded resources
 *    (tracking pixels).
 */
export async function inspectEpubBufferWithPipeline(buffer: Buffer): Promise<EpubFirewallReport> {
  return runPipeline(buffer);
}

async function runPipeline(buffer: Buffer): Promise<EpubFirewallReport> {
  const limits = epubFirewallLimits();
  const tiers: EpubTierReport[] = [];

  const tier0 = await runTier0(buffer, limits);
  tiers.push(buildTier(0, tier0.violations, true));
  let safe = tier0.violations.length === 0;
  let violations = tier0.violations;
  let spineDocumentCount = 0;

  if (safe) {
    const tier1Outcome = await runTier1(buffer, tier0.entries, limits);
    tiers.push(buildTier(1, tier1Outcome.violations, true));
    violations = tier1Outcome.violations;
    spineDocumentCount = tier1Outcome.spineDocumentCount;
    safe = violations.length === 0;

    if (safe) {
      const tier2Violations = await runTier2(buffer, tier0.entries, limits);
      tiers.push(buildTier(2, tier2Violations, true));
      violations = tier2Violations;
      safe = violations.length === 0;
    } else {
      tiers.push(skippedTier(2));
    }
  } else {
    tiers.push(skippedTier(1), skippedTier(2));
  }

  return { schemaVersion: 1, safe, pageCount: spineDocumentCount, violations, tiers };
}

// ── Tier 0: ZIP structure ────────────────────────────────────────────────────

async function runTier0(
  buffer: Buffer,
  limits: EpubFirewallLimits,
): Promise<{ violations: EpubViolation[]; entries: ZipEntry[] }> {
  const violations: EpubViolation[] = [];

  let entries: ZipEntry[];
  try {
    entries = parseZipCentralDirectory(buffer);
    if (entries.length === 0) {
      violations.push({ code: 'MISSING_EPUB_ZIP', detail: 'archivo ZIP sin entradas' });
      return { violations, entries: [] };
    }
  } catch (error) {
    violations.push({ code: 'MISSING_EPUB_ZIP', detail: describe(error) });
    return { violations, entries: [] };
  }

  violations.push(
    ...entries
      .filter((entry) => isPathTraversalEntry(entry.name))
      .map((entry) => ({ code: 'PATH_TRAVERSAL' as const, detail: entry.name })),
  );

  if (entries.length > limits.maxEntries) {
    violations.push({
      code: 'EPUB_ENTRY_LIMIT_EXCEEDED',
      detail: `${entries.length} entradas superan el límite de ${limits.maxEntries}`,
    });
  }

  let totalUncompressed = 0;
  for (const entry of entries) {
    totalUncompressed += entry.uncompressedSize;
    if (
      entry.compressionMethod !== 0 &&
      entry.compressedSize > 0 &&
      entry.uncompressedSize > 1024 * 1024 &&
      entry.uncompressedSize / entry.compressedSize > MAX_EPUB_COMPRESSION_RATIO
    ) {
      violations.push({
        code: 'EPUB_ZIP_BOMB',
        detail: `${entry.name} ratio ${(entry.uncompressedSize / entry.compressedSize).toFixed(0)}:1`,
      });
    }
  }
  if (totalUncompressed > limits.maxTotalUncompressedBytes) {
    violations.push({
      code: 'EPUB_ZIP_BOMB',
      detail: `descompresión total ${(totalUncompressed / (1024 * 1024)).toFixed(0)} MiB supera ${Math.round(
        limits.maxTotalUncompressedBytes / (1024 * 1024),
      )} MiB`,
    });
  }

  const mimetypeEntry = entries.find((entry) => entry.name === 'mimetype');
  if (!mimetypeEntry) {
    violations.push({ code: 'MISSING_EPUB_MIMETYPE', detail: 'sin entrada mimetype' });
  } else if (entries.indexOf(mimetypeEntry) !== 0) {
    violations.push({
      code: 'MISSING_EPUB_MIMETYPE',
      detail: 'la entrada mimetype no es la primera del archivo',
    });
  } else {
    const content = await readEntryText(buffer, mimetypeEntry, limits.maxScanDocBytes);
    if ((content ?? '').replace(/\s+/g, '') !== EPUB_MIMETYPE) {
      violations.push({
        code: 'MISSING_EPUB_MIMETYPE',
        detail: content ? content.slice(0, 60) : 'sin leer',
      });
    }
  }

  return { violations, entries };
}

// ── Tier 1: container.xml → OPF + DRM ────────────────────────────────────────

async function runTier1(
  buffer: Buffer,
  entries: ZipEntry[],
  limits: EpubFirewallLimits,
): Promise<{ violations: EpubViolation[]; spineDocumentCount: number }> {
  const violations: EpubViolation[] = [];

  const containerEntry = entries.find((entry) => entry.name === 'META-INF/container.xml');
  if (!containerEntry) {
    violations.push({ code: 'MISSING_CONTAINER_XML' });
    return { violations, spineDocumentCount: 0 };
  }

  const encryptionEntry = entries.find((entry) => entry.name === 'META-INF/encryption.xml');
  if (encryptionEntry) {
    const encryptionXml = await readEntryText(buffer, encryptionEntry, limits.maxScanDocBytes);
    if (encryptionXml && /EncryptedData/i.test(encryptionXml)) {
      violations.push({ code: 'DRM_ENCRYPTED', detail: 'META-INF/encryption.xml' });
    }
  }

  const containerXml = await readEntryText(buffer, containerEntry, limits.maxScanDocBytes);
  const opfPath = containerXml?.match(/<rootfile[^>]*full-path="([^"]+)"/i)?.[1];
  if (!opfPath) {
    violations.push({ code: 'MISSING_OPF', detail: 'container.xml no declara rootfile' });
    return { violations, spineDocumentCount: 0 };
  }

  const opfEntry = entries.find((entry) => entry.name === opfPath);
  if (!opfEntry) {
    violations.push({ code: 'MISSING_OPF', detail: `sin ${opfPath}` });
    return { violations, spineDocumentCount: 0 };
  }

  const opf = await readEntryText(buffer, opfEntry, limits.maxScanDocBytes);
  if (!opf || !/<package[\s>]/i.test(opf) || !/<spine[\s>]/i.test(opf)) {
    violations.push({ code: 'MISSING_OPF', detail: `${opfPath} no es un package OPF válido` });
    return { violations, spineDocumentCount: 0 };
  }

  const spineDocumentCount = opf.match(/<itemref\b/gi)?.length ?? 0;
  if (spineDocumentCount === 0) {
    violations.push({ code: 'MISSING_OPF', detail: 'spine sin itemref' });
  }
  return { violations, spineDocumentCount };
}

// ── Tier 2: document content scan ────────────────────────────────────────────

const XXE_RE = /<!ENTITY[^>]*\bSYSTEM\b[^>]*>/i;
const ACTIVE_CONTENT_RES: ReadonlyArray<{ re: RegExp }> = [
  { re: /<\s*script\b/i },
  { re: /<\s*iframe\b/i },
  { re: /<\s*object\b/i },
  { re: /<\s*embed\b/i },
  { re: /\son[a-z]+\s*=\s*["']?[^\s>]/i },
];
const SUSPICIOUS_URI_RE = /(?:\bhref|xlink:href)\s*=\s*["']?\s*(?:javascript|vbscript|file)\s*:/i;
const REMOTE_RESOURCE_RES: ReadonlyArray<{ re: RegExp }> = [
  { re: /(?:\bsrc|xlink:href)\s*=\s*["']?\s*(?:https?:)?\/\/[^"'\s>]+/i },
  { re: /\bsrc\s*=\s*["']?\s*data:[^"'\s>]+/i },
];

async function runTier2(
  buffer: Buffer,
  entries: ZipEntry[],
  limits: EpubFirewallLimits,
): Promise<EpubViolation[]> {
  const violations: EpubViolation[] = [];

  for (const entry of entries.filter((candidate) =>
    TEXT_DOC_EXTENSIONS.has(extensionOf(candidate.name)),
  )) {
    if (entry.uncompressedSize > limits.maxScanDocBytes) {
      // Documento fuera del presupuesto de escaneo: el tope global de
      // descompresión ya acotó su impacto en memoria, pero no inspeccionamos
      // contenido mayor al límite por documento.
      continue;
    }
    const text = await readEntryText(buffer, entry, limits.maxScanDocBytes);
    if (!text) {
      continue;
    }
    if (XXE_RE.test(text)) {
      violations.push({ code: 'XXE_ENTITY', detail: label(entry.name, '<!ENTITY ... SYSTEM') });
    }
    for (const rule of ACTIVE_CONTENT_RES) {
      const active = rule.re.exec(text);
      if (active) {
        violations.push({
          code: 'ACTIVE_CONTENT',
          detail: label(entry.name, active[0].replace(/\s+/g, ' ').trim().slice(0, 40)),
        });
      }
    }
    const uriMatch = SUSPICIOUS_URI_RE.exec(text);
    if (uriMatch) {
      violations.push({
        code: 'SUSPICIOUS_URI',
        detail: label(entry.name, uriMatch[0].replace(/\s+/g, '').slice(0, 60)),
      });
    }
    for (const rule of REMOTE_RESOURCE_RES) {
      const remote = rule.re.exec(text);
      if (remote) {
        violations.push({
          code: 'REMOTE_RESOURCE',
          detail: label(entry.name, remote[0].replace(/\s+/g, '').slice(0, 80)),
        });
      }
    }
  }

  return violations;
}

function label(entryName: string, marker: string): string {
  return `${marker} en ${entryName}`;
}

// ── Shared plumbing ──────────────────────────────────────────────────────────

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

/**
 * Decompresses one central-directory entry of `buffer` as UTF-8 text, or
 * `null` when it is beyond `maxBytes` or cannot be read. The pipeline buffer is
 * passed explicitly, so concurrent runs over different buffers never share
 * mutable state.
 */
async function readEntryText(
  buffer: Buffer,
  entry: ZipEntry,
  maxBytes = DEFAULT_MAX_EPUB_SCAN_DOC_BYTES,
): Promise<string | null> {
  if (entry.uncompressedSize > maxBytes) {
    return null;
  }
  try {
    const zip = await JSZip.loadAsync(buffer);
    const file = zip.file(entry.name);
    return file ? await file.async('string') : null;
  } catch {
    return null;
  }
}

function buildTier(
  index: 0 | 1 | 2,
  violations: readonly EpubViolation[],
  ran: boolean,
): EpubTierReport {
  const checks = TIER_CHECKS[index].map((id) => {
    const code = CHECK_CODES[id] ?? id;
    const own = violations.filter((violation) => violation.code === code);
    return {
      id,
      status: (own.length > 0 ? 'violation' : ran ? 'passed' : 'skipped') as EpubCheckStatus,
      violations: own,
    };
  });
  const status: EpubCheckStatus = checks.some((check) => check.status === 'violation')
    ? 'violation'
    : ran
      ? 'passed'
      : 'skipped';
  return { index, name: TIER_NAMES[index], status, checks };
}

function skippedTier(index: 0 | 1 | 2): EpubTierReport {
  return {
    index,
    name: TIER_NAMES[index],
    status: 'skipped',
    checks: TIER_CHECKS[index].map((id) => ({ id, status: 'skipped' as const, violations: [] })),
  };
}

function describe(error: unknown): string {
  if (error instanceof ZipBoundsError) {
    return error.message;
  }
  return error instanceof Error && error.message ? error.message : 'archivo no legible como EPUB';
}
