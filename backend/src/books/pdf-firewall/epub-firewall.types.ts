import type { PdfViolation } from './pdf-firewall.types.js';

/**
 * Verdict vocabulary of the EPUB firewall (S4). Every stable PDF code is also
 * valid so reports stay structurally compatible with the /admin pipeline
 * visualization; EPUB-specific codes are appended.
 */
export type EpubViolationCode =
  | PdfViolation['code']
  | 'MISSING_EPUB_ZIP'
  | 'MISSING_EPUB_MIMETYPE'
  | 'PATH_TRAVERSAL'
  | 'EPUB_ENTRY_LIMIT_EXCEEDED'
  | 'EPUB_ZIP_BOMB'
  | 'MISSING_CONTAINER_XML'
  | 'MISSING_OPF'
  | 'DRM_ENCRYPTED'
  | 'XXE_ENTITY'
  | 'ACTIVE_CONTENT'
  | 'REMOTE_RESOURCE';

export type EpubViolation = {
  code: EpubViolationCode;
  detail?: string;
};

export type EpubFirewallVerdict = {
  safe: boolean;
  /** Number of spine documents the OPF declares (synthetic page basis, S5). */
  spineDocumentCount: number;
  violations: EpubViolation[];
};

/** How one pipeline check ended: clean pass, finding, or it never ran. */
export type EpubCheckStatus = 'passed' | 'violation' | 'skipped';

/** One deterministic check of the EPUB pipeline, keyed by stable `id`. */
export type EpubCheckReport = {
  id: string;
  status: EpubCheckStatus;
  violations: EpubViolation[];
};

/** One tier (0, 1 or 2) of the EPUB pipeline with its ordered checks. */
export type EpubTierReport = {
  index: 0 | 1 | 2;
  name: 'zip' | 'container' | 'content';
  status: EpubCheckStatus;
  checks: EpubCheckReport[];
};

/**
 * Structured per-tier pipeline report for /admin, mirroring the PDF firewall
 * report shape: every tier and every check with `passed` / `violation` /
 * `skipped` states, tiers always present in order 0, 1, 2.
 */
export type EpubFirewallReport = {
  schemaVersion: 1;
  safe: boolean;
  pageCount: number;
  violations: EpubViolation[];
  tiers: EpubTierReport[];
};
