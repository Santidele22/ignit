import { PDF_HEADER_SCAN_WINDOW } from '../pdf.util.js';

/**
 * Tier 1 of the PDF firewall: a lexical scan of raw PDF syntax outside literal
 * strings and binary stream bodies.
 */
export const FORBIDDEN_PDF_NAMES = [
  'JavaScript',
  'JS',
  'AA',
  'Launch',
  'GoToR',
  'GoToE',
  'RichMedia',
  'Flash',
  '3D',
  'Sound',
  'Movie',
  'Rendition',
  'XFA',
  'EmbeddedFiles',
  'EF',
  'Filespec',
  'FileAttachment',
  'SubmitForm',
  'ResetForm',
  'ImportData',
  'OPI',
  'SpiderInfo',
  'Encrypt',
  'Crypt',
] as const;

export type ForbiddenPdfName = (typeof FORBIDDEN_PDF_NAMES)[number];

const FORBIDDEN_NAME_SET = new Set<string>(FORBIDDEN_PDF_NAMES);

const ENCRYPTION_NAME_SET = new Set<string>(['Encrypt', 'Crypt']);

/** `/Encrypt` and stream-level `/Crypt` prevent full content inspection. */
export function isEncryptionPdfName(name: string): boolean {
  return ENCRYPTION_NAME_SET.has(name);
}

export function isForbiddenPdfName(name: string): name is ForbiddenPdfName {
  return FORBIDDEN_NAME_SET.has(name);
}

/**
 * Characters that terminate a PDF name token: whitespace (NUL normalized to
 * space beforehand) and the delimiters `()<>[]{}/%#`.
 */
const NAME_TERMINATORS = '[\\s()<>\\[\\]{}/%#]';

/**
 * Decodes `#XX` name escapes case-insensitively. When `pdf-lib` parses a name
 * containing lowercase hex (e.g. `/#4aavaScript`), it only decodes uppercase
 * hex and re-encodes `#` as `#23` (`/#234aavaScript`); running a second pass
 * when `#23` was present recovers the true underlying PDF name.
 */
export function normalizePdfNames(raw: string): string {
  const once = decodeHexEscapesOnce(raw);
  return raw.toLowerCase().includes('#23') ? decodeHexEscapesOnce(once) : once;
}

function decodeHexEscapesOnce(input: string): string {
  return input.replace(/#([0-9a-fA-F]{2})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

/**
 * Masks PDF comments, literal strings `(...)` and `stream ... endstream` bodies
 * with spaces so URLs like `(https://.../JavaScript/Guide)` or random bytes in
 * compressed image streams do not false-positive in Tier 1 while keeping every
 * dictionary/array/trailer `/Name` token visible.
 */
export function stripStringsAndStreamsForLexicalScan(raw: string): string {
  const chars = Array.from(raw);
  const len = chars.length;
  let i = 0;

  while (i < len) {
    const ch = chars[i];
    if (ch === '\0') {
      chars[i] = ' ';
      i += 1;
      continue;
    }
    if (ch === '%') {
      while (i < len && chars[i] !== '\n' && chars[i] !== '\r') {
        chars[i] = ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '(') {
      chars[i] = ' ';
      i += 1;
      let depth = 1;
      while (i < len && depth > 0) {
        if (chars[i] === '\\') {
          chars[i] = ' ';
          if (i + 1 < len) chars[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (chars[i] === '(') depth += 1;
        else if (chars[i] === ')') depth -= 1;
        chars[i] = ' ';
        i += 1;
      }
      continue;
    }
    if (
      ch === 's' &&
      raw.startsWith('stream', i) &&
      (i === 0 || isLexicalBoundary(raw[i - 1])) &&
      (raw[i + 6] === '\n' || (raw[i + 6] === '\r' && raw[i + 7] === '\n'))
    ) {
      const bodyStart = raw[i + 6] === '\r' ? i + 8 : i + 7;
      const endIdx = raw.indexOf('endstream', bodyStart);
      if (endIdx !== -1) {
        for (let k = bodyStart; k < endIdx; k += 1) {
          chars[k] = ' ';
        }
        i = endIdx + 9;
        continue;
      }
    }
    i += 1;
  }

  return chars.join('');
}

function isLexicalBoundary(ch: string): boolean {
  return (
    ch === ' ' ||
    ch === '\n' ||
    ch === '\r' ||
    ch === '\t' ||
    ch === '\f' ||
    ch === '\0' ||
    ch === '>' ||
    ch === ']' ||
    ch === ')'
  );
}

/**
 * Forbidden `/Name` tokens found in raw PDF syntax, deduplicated and ordered by
 * their first occurrence.
 */
export function findForbiddenNames(raw: string): ForbiddenPdfName[] {
  const scrubbed = stripStringsAndStreamsForLexicalScan(raw);
  const normalized = normalizePdfNames(scrubbed).split('\0').join(' ');
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

/** Short 2-byte executable headers that are only polyglots at byte offset 0. */
const OFFSET_ZERO_SIGNATURES: readonly PolyglotSignature[] = [
  { label: 'PE', bytes: Buffer.from([0x4d, 0x5a]) },
  { label: 'SHELL', bytes: Buffer.from([0x23, 0x21]) },
];

/**
 * Binary signatures that must never appear *before* the `%PDF-` header (or
 * appended after the final `%%EOF` trailer).
 */
const BINARY_POLYGLOT_SIGNATURES: readonly PolyglotSignature[] = [
  { label: 'ZIP', bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04]) },
  { label: 'ZIP', bytes: Buffer.from([0x50, 0x4b, 0x05, 0x06]) },
  { label: 'ZIP', bytes: Buffer.from([0x50, 0x4b, 0x07, 0x08]) },
  { label: 'ELF', bytes: Buffer.from([0x7f, 0x45, 0x4c, 0x46]) },
  { label: 'MACH-O', bytes: Buffer.from([0xcf, 0xfa, 0xed, 0xfe]) },
  { label: 'MACH-O', bytes: Buffer.from([0xce, 0xfa, 0xed, 0xfe]) },
  { label: 'MACH-O', bytes: Buffer.from([0xfe, 0xed, 0xfa, 0xce]) },
  { label: 'MACH-O', bytes: Buffer.from([0xfe, 0xed, 0xfa, 0xcf]) },
  { label: 'MACH-O', bytes: Buffer.from([0xca, 0xfe, 0xba, 0xbe]) },
  { label: 'RAR', bytes: Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]) },
  { label: '7Z', bytes: Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) },
  { label: 'GZIP', bytes: Buffer.from([0x1f, 0x8b, 0x08]) },
  { label: 'WASM', bytes: Buffer.from([0x00, 0x61, 0x73, 0x6d]) },
];

/** Text signatures matched case-insensitively against prefix/trailer regions. */
const TEXT_POLYGLOT_SIGNATURES: readonly PolyglotTextSignature[] = [
  { label: 'HTML', marker: '<!doctype html' },
  { label: 'HTML', marker: '<html' },
  { label: 'HTML', marker: '<script' },
  { label: 'HTML', marker: '<iframe' },
  { label: 'HTML', marker: '<svg' },
  { label: 'PHP', marker: '<?php' },
  { label: 'RTF', marker: '{\\rtf' },
];

const EOF_MARKER = Buffer.from('%%EOF');
const TRAILER_SCAN_CAP = 65_536;

/**
 * Returns the label of the polyglot signature found before the PDF header or
 * appended after the final `%%EOF` marker, or `null`.
 */
export function detectPolyglotSignature(
  buffer: Buffer,
  headerIndex: number,
): string | null {
  const limit =
    headerIndex < 0 ? Math.min(buffer.length, PDF_HEADER_SCAN_WINDOW) : headerIndex;
  const prefix = buffer.subarray(0, limit);
  const prefixHit = scanPolyglotSlice(prefix, true);
  if (prefixHit) {
    return prefixHit;
  }

  if (headerIndex >= 0) {
    const lastEof = buffer.lastIndexOf(EOF_MARKER);
    if (lastEof !== -1) {
      const tail = buffer.subarray(
        lastEof + EOF_MARKER.length,
        Math.min(buffer.length, lastEof + EOF_MARKER.length + TRAILER_SCAN_CAP),
      );
      const tailHit = scanPolyglotSlice(tail, false);
      if (tailHit) {
        return tailHit;
      }
    }
  }

  return null;
}

function scanPolyglotSlice(slice: Buffer, includeOffsetZero: boolean): string | null {
  if (slice.length === 0) {
    return null;
  }

  if (includeOffsetZero) {
    for (const signature of OFFSET_ZERO_SIGNATURES) {
      if (
        slice.length >= signature.bytes.length &&
        slice.subarray(0, signature.bytes.length).equals(signature.bytes)
      ) {
        return signature.label;
      }
    }
  }

  for (const signature of BINARY_POLYGLOT_SIGNATURES) {
    if (slice.indexOf(signature.bytes) !== -1) {
      return signature.label;
    }
  }

  const text = slice.toString('latin1').toLowerCase();
  for (const signature of TEXT_POLYGLOT_SIGNATURES) {
    if (text.includes(signature.marker)) {
      return signature.label;
    }
  }

  return null;
}

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const BLOCKED_METADATA_HOSTS = new Set([
  '169.254.169.254',
  '169.254.170.2',
  'metadata.google.internal',
  'metadata',
  '100.100.100.200',
]);

function isBlockedMetadataHostname(rawHostname: string): boolean {
  const host = rawHostname.toLowerCase().replace(/\.+$/, '');
  if (BLOCKED_METADATA_HOSTS.has(host) || host.startsWith('169.254.')) {
    return true;
  }
  if (host.startsWith('[') && host.endsWith(']')) {
    const ipv6 = host.slice(1, -1);
    if (
      ipv6 === 'fd00:ec2::254' ||
      ipv6.startsWith('fe80:') ||
      ipv6.includes('169.254.') ||
      ipv6.includes('a9fe:')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Validates a PDF `/URI` or catalog `/Base` target. Normal `https://`,
 * `http://`, `mailto:` and `#anchor` links in technical books are allowed;
 * script/local/SMB schemes, UNC paths, phishing userinfo credentials and cloud
 * metadata SSRF endpoints return a Spanish rejection reason.
 */
export function inspectPdfUri(rawUri: string): string | null {
  const trimmed = rawUri.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (hasControlCharacters(trimmed)) {
    return 'caracteres de control en URI';
  }
  if (trimmed.startsWith('#')) {
    return null;
  }
  if (
    trimmed.startsWith('\\\\') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return 'ruta UNC o relativa externa';
  }

  const schemeMatch = SCHEME_RE.exec(trimmed);
  if (!schemeMatch) {
    return 'ruta UNC o relativa externa';
  }

  const scheme = schemeMatch[1].toLowerCase();
  if (scheme === 'mailto') {
    return /<script/i.test(trimmed) ? 'inyección en URI mailto' : null;
  }
  if (scheme !== 'http' && scheme !== 'https') {
    return `esquema no permitido (${scheme}:)`;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return 'URI malformada';
  }

  if (parsed.username !== '' || parsed.password !== '') {
    return 'credenciales embebidas en URI';
  }
  if (isBlockedMetadataHostname(parsed.hostname)) {
    return 'host de metadatos bloqueado';
  }

  return null;
}

const METADATA_INJECTION_RE = /<\s*script\b|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html/i;

/**
 * Validates `/Info` string fields and XMP `/Metadata` payloads against script
 * injection, NUL-byte smuggling and megabyte metadata floods.
 */
export function inspectMetadataText(raw: string, maxLength: number): string | null {
  if (raw.length > maxLength) {
    return `metadatos exceden el límite (${maxLength} caracteres)`;
  }
  if (raw.includes('\x00')) {
    return 'bytes nulos en metadatos';
  }
  if (METADATA_INJECTION_RE.test(raw)) {
    return 'inyección de script en metadatos';
  }
  return null;
}
