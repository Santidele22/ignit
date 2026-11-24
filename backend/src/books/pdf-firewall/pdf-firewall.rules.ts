import { PDF_HEADER_SCAN_WINDOW } from '../pdf.util.js';

/**
 * Tier 1 of the PDF firewall: a lexical scan of the raw bytes.
 *
 * The scan is deliberately dumb and paranoid — it looks for the *names* that
 * give a PDF active content (JavaScript, launch actions, embedded files, …)
 * anywhere in the file, including names the parser would never resolve. It is
 * a safety net in front of the structural tier, not a replacement for it: the
 * structural walk (tier 2) inspects the real object graph, so a name that is
 * compressed inside an `/ObjStm` is invisible here and caught there.
 */
export const FORBIDDEN_PDF_NAMES = [
  'JavaScript',
  'JS',
  'OpenAction',
  'AA',
  'Launch',
  'RichMedia',
  'Flash',
  '3D',
  'XFA',
  'EmbeddedFiles',
  'EF',
  'Filespec',
  'SubmitForm',
  'ImportData',
  'Encrypt',
] as const;

export type ForbiddenPdfName = (typeof FORBIDDEN_PDF_NAMES)[number];

const FORBIDDEN_NAME_SET = new Set<string>(FORBIDDEN_PDF_NAMES);

/** `/Encrypt` is always fatal: the inspection cannot see inside encrypted streams. */
export const ENCRYPTION_NAME: ForbiddenPdfName = 'Encrypt';

export function isForbiddenPdfName(name: string): name is ForbiddenPdfName {
  return FORBIDDEN_NAME_SET.has(name);
}

/**
 * Characters that terminate a PDF name token: whitespace and the delimiters
 * `()<>[]{}/%`. `#` is added because a leftover `#` after escape decoding is
 * not a regular name character either.
 */
const NAME_TERMINATORS = '[\\s()<>\\[\\]{}/%#]';

/**
 * Decodes `#XX` name escapes (case insensitive) so `/#4a#61#76...` is seen as
 * `/JavaScript`. Applied to the whole buffer, which is intentional: it also
 * normalizes escapes that live inside dictionaries, strings or content
 * streams. The tradeoff is that a decoded escape can splice bytes together
 * that were never adjacent in a single token — for a *reject* filter a false
 * positive is the safe direction.
 */
export function normalizePdfNames(raw: string): string {
  return raw.replace(/#([0-9a-fA-F]{2})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

/**
 * Forbidden `/Name` tokens found in the raw bytes, deduplicated and ordered by
 * their first occurrence.
 *
 * Boundary rules (documented because the whole buffer is prose + compressed
 * streams):
 * - the token must be a `/`-prefixed name, so the word "JavaScript" in visible
 *   text never matches;
 * - the name must end at a name terminator, so `/JSX`, `/AAPL`, `/EFile` or
 *   `/LaunchPad` do not match `/JS`, `/AA`, `/EF` or `/Launch`;
 * - the search does not know about PDF string scoping, so a content stream that
 *   literally writes `(/JS in parentheses)` would trip it. That false positive
 *   rejects a harmless file, which is preferred over letting active content
 *   through; compressed content streams (the common case) are not literal
 *   anyway.
 */
export function findForbiddenNames(raw: string): ForbiddenPdfName[] {
  const normalized = normalizePdfNames(raw);
  const hits: Array<{ name: ForbiddenPdfName; index: number }> = [];

  for (const name of FORBIDDEN_PDF_NAMES) {
    const token = new RegExp(`/${name}(?=${NAME_TERMINATORS}|$)`, 'g');
    const match = token.exec(normalized);
    if (match) {
      hits.push({ name, index: match.index });
    }
  }

  return hits.sort((left, right) => left.index - right.index).map((hit) => hit.name);
}

type PolyglotSignature = { label: string; bytes: Buffer };
type PolyglotTextSignature = { label: string; marker: string };

/**
 * Binary signatures that must never appear *before* the `%PDF-` header: a file
 * whose header is wrapped inside a ZIP/ELF/Mach-O payload is a polyglot, not a
 * PDF, and would be executed as that other format by the wrong consumer.
 */
const BINARY_POLYGLOT_SIGNATURES: readonly PolyglotSignature[] = [
  { label: 'ZIP', bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04]) },
  { label: 'ELF', bytes: Buffer.from([0x7f, 0x45, 0x4c, 0x46]) },
  { label: 'MACH-O', bytes: Buffer.from([0xcf, 0xfa, 0xed, 0xfe]) },
  { label: 'MACH-O', bytes: Buffer.from([0xce, 0xfa, 0xed, 0xfe]) },
  { label: 'MACH-O', bytes: Buffer.from([0xfe, 0xed, 0xfa, 0xce]) },
  { label: 'MACH-O', bytes: Buffer.from([0xfe, 0xed, 0xfa, 0xcf]) },
  { label: 'MACH-O', bytes: Buffer.from([0xca, 0xfe, 0xba, 0xbe]) },
];

/** Text signatures are matched case-insensitively against the latin1 prefix. */
const TEXT_POLYGLOT_SIGNATURES: readonly PolyglotTextSignature[] = [
  { label: 'HTML', marker: '<!doctype html' },
  { label: 'HTML', marker: '<html' },
];

/**
 * Returns the label of the polyglot signature found before the PDF header, or
 * `null`. The comparison is bounded to the bytes in front of the header, so a
 * real PDF may still contain HTML or ZIP-looking bytes *after* it.
 */
export function detectPolyglotSignature(
  buffer: Buffer,
  headerIndex: number,
): string | null {
  const limit =
    headerIndex < 0 ? Math.min(buffer.length, PDF_HEADER_SCAN_WINDOW) : headerIndex;
  const prefix = buffer.subarray(0, limit);

  for (const signature of BINARY_POLYGLOT_SIGNATURES) {
    if (prefix.indexOf(signature.bytes) !== -1) {
      return signature.label;
    }
  }

  const text = prefix.toString('latin1').toLowerCase();
  for (const signature of TEXT_POLYGLOT_SIGNATURES) {
    if (text.includes(signature.marker)) {
      return signature.label;
    }
  }

  return null;
}
