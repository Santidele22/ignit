/**
 * Verdict vocabulary of the PDF firewall (S1).
 *
 * Every rejection carries a stable machine code plus an optional human detail
 * (the offending `/Name` or the page-count bound). The upload handler turns
 * the list into a single Spanish `400` message.
 */
export type PdfViolationCode =
  | 'MISSING_PDF_HEADER'
  | 'POLYGLOT'
  | 'ACTIVE_CONTENT_KEY'
  | 'ENCRYPTED'
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
