/**
 * Upload fixtures shared by the book e2e suites.
 *
 * The PDF firewall (S1) parses every upload with `pdf-lib` and rejects any file
 * it cannot walk, so a `%PDF-1.4`-only stub never reaches storage. This is the
 * smallest document that survives every tier: a valid header, no forbidden
 * names and exactly one page.
 *
 * It stays a literal so that a test uploads byte-for-byte the buffer it later
 * asserts on.
 */
export const MINIMAL_PDF_BUFFER = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj',
    'trailer << /Root 1 0 R /Size 4 >>',
    '%%EOF',
    '',
  ].join('\n'),
);
