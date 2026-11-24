/**
 * Verdict vocabulary of the PDF firewall (S1 + hardened rules).
 *
 * Every rejection carries a stable machine code plus an optional human detail
 * (the offending `/Name`, URI reason, resource cap or page-count bound). The
 * upload handler turns the list into a single Spanish `400` message.
 */
export type PdfViolationCode =
  | 'MISSING_PDF_HEADER'
  | 'POLYGLOT'
  | 'ACTIVE_CONTENT_KEY'
  | 'ENCRYPTED'
  | 'EXTERNAL_STREAM'
  | 'SUSPICIOUS_URI'
  | 'SUSPICIOUS_METADATA'
  | 'RESOURCE_LIMIT_EXCEEDED'
  | 'HIDDEN_CONTENT'
  | 'PARSE_ERROR'
  | 'PAGE_COUNT_OUT_OF_BOUNDS';

export type PdfViolation = {
  code: PdfViolationCode;
  detail?: string;
};

export type PdfFirewallVerdict = {
  safe: boolean;
  pageCount: number;
  violations: PdfViolation[];
};

/** How one pipeline check ended: clean pass, finding, or it never ran. */
export type PdfCheckStatus = 'passed' | 'violation' | 'skipped';

/** One deterministic check of the firewall pipeline, keyed by stable `id`. */
export type PdfCheckReport = {
  id: string;
  status: PdfCheckStatus;
  violations: PdfViolation[];
};

/** One tier (0, 1 or 2) of the firewall pipeline with its ordered checks. */
export type PdfTierReport = {
  index: 0 | 1 | 2;
  name: 'header' | 'lexical' | 'structure';
  status: PdfCheckStatus;
  checks: PdfCheckReport[];
};

/**
 * Structured per-tier pipeline report (S1, /admin dashboard): every tier and
 * every check with `passed` / `violation` / `skipped` states. Persistence and
 * `/admin` consume exactly this object.
 */
export type PdfFirewallReport = {
  schemaVersion: 1;
  safe: boolean;
  pageCount: number;
  violations: PdfViolation[];
  tiers: PdfTierReport[];
};
