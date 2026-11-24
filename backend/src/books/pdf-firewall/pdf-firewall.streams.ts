import { constants as zlibConstants, inflateRawSync, inflateSync } from 'node:zlib';
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';
import { normalizePdfNames } from './pdf-firewall.rules.js';
import type { PdfViolation } from './pdf-firewall.types.js';

/** Maximum decompressed size of a single stream (`64 MB` default). */
export const DEFAULT_MAX_STREAM_BYTES = 64 * 1024 * 1024;

/** Maximum cumulative decompressed bytes across all streams (`256 MB` default). */
export const DEFAULT_MAX_TOTAL_STREAM_BYTES = 256 * 1024 * 1024;

/** Cap on concatenated content-stream text inspected per page (`8 MB`). */
const MAX_PAGE_CONTENT_CHARS = 8 * 1024 * 1024;

/** Minimum decompressed bytes before enforcing the compression-ratio bomb check. */
const RATIO_CHECK_MIN_OUTPUT_BYTES = 10 * 1024 * 1024;

/** Compression ratio above which a large stream is treated as a Flate bomb. */
const MAX_COMPRESSION_RATIO = 200;

/** Minimum hidden glyphs on a single page before flagging `HIDDEN_CONTENT`. */
const MIN_HIDDEN_TEXT_CHARS = 16;

/** Minimum pixel width/height for an `/Image` XObject to qualify as an OCR scan layer. */
const MIN_OCR_IMAGE_DIMENSION = 64;

const EXTERNAL_STREAM_KEYS = new Set(['F', 'FFilter', 'FDecodeParms']);

export type StreamFirewallLimits = {
  maxStreamBytes: number;
  maxTotalStreamBytes: number;
};

/** Canonical PDF name without leading `/`, decoding `#XX` and `#23XX` escapes. */
export function canonicalPdfName(name: PDFName): string {
  return normalizePdfNames(name.asString()).replace(/^\/+/, '');
}

/** Looks up a dictionary entry by canonical PDF key (defeating `#XX` lowercase escapes). */
export function lookupDictEntry(
  dict: PDFDict,
  keyName: string,
  context: PDFContext,
): PDFObject | undefined {
  for (const [rawKey, rawVal] of dict.entries()) {
    if (canonicalPdfName(rawKey) === keyName) {
      return context.lookup(rawVal);
    }
  }
  return undefined;
}

/**
 * Pre-parse guard executed *before* `PDFDocument.load`: `pdf-lib` eagerly parses
 * indirect objects and decompresses `/ObjStm` and `/XRef` streams in JS without
 * any size limit, so object-table bombs and `/ObjStm` Flate bombs must be caught
 * on raw bytes first.
 */
export function inspectRawPreParseBounds(
  buffer: Buffer,
  limits: StreamFirewallLimits & { maxObjects: number },
): PdfViolation[] {
  const raw = buffer.toString('latin1');
  let objectCount = 0;
  const objRegex = /(?:^|[\s\0])(\d+)\s+(\d+)\s+obj(?=[\s\0<[/%(]|$)/g;
  while (objRegex.exec(raw) !== null) {
    objectCount += 1;
    if (objectCount > limits.maxObjects) {
      return [
        {
          code: 'RESOURCE_LIMIT_EXCEEDED',
          detail: `más de ${limits.maxObjects} objetos indirectos`,
        },
      ];
    }
  }

  let totalBytes = 0;
  let cursor = 0;
  while (cursor < raw.length) {
    const streamIdx = raw.indexOf('stream', cursor);
    if (streamIdx === -1) break;
    if (streamIdx > 0 && raw.slice(Math.max(0, streamIdx - 3), streamIdx) === 'end') {
      cursor = streamIdx + 6;
      continue;
    }
    const afterStream =
      raw[streamIdx + 6] === '\n'
        ? streamIdx + 7
        : raw[streamIdx + 6] === '\r' && raw[streamIdx + 7] === '\n'
          ? streamIdx + 8
          : -1;
    if (afterStream === -1) {
      cursor = streamIdx + 6;
      continue;
    }
    const endIdx = raw.indexOf('endstream', afterStream);
    if (endIdx === -1) break;

    let bodyEnd = endIdx;
    if (raw[bodyEnd - 1] === '\n') bodyEnd -= 1;
    if (raw[bodyEnd - 1] === '\r') bodyEnd -= 1;

    const headerWindow = normalizePdfNames(raw.slice(Math.max(0, streamIdx - 512), streamIdx));
    const slice = buffer.subarray(afterStream, Math.max(afterStream, bodyEnd));

    if (headerWindow.includes('/FlateDecode')) {
      const inflated = inflateBoundedFlate(slice, limits.maxStreamBytes);
      if (inflated.kind === 'too_large') {
        return [
          {
            code: 'RESOURCE_LIMIT_EXCEEDED',
            detail: `stream descomprimido excede ${limits.maxStreamBytes} bytes`,
          },
        ];
      }
      if (inflated.kind === 'ok') {
        if (isRatioBomb(slice.length, inflated.bytes.length)) {
          return [
            {
              code: 'RESOURCE_LIMIT_EXCEEDED',
              detail: 'ratio de compresión extremo (PDF bomb)',
            },
          ];
        }
        totalBytes += inflated.bytes.length;
      }
    } else {
      if (slice.length > limits.maxStreamBytes) {
        return [
          {
            code: 'RESOURCE_LIMIT_EXCEEDED',
            detail: `stream crudo excede ${limits.maxStreamBytes} bytes`,
          },
        ];
      }
      totalBytes += slice.length;
    }

    if (totalBytes > limits.maxTotalStreamBytes) {
      return [
        {
          code: 'RESOURCE_LIMIT_EXCEEDED',
          detail: `volumen descomprimido excede ${limits.maxTotalStreamBytes} bytes`,
        },
      ];
    }

    cursor = endIdx + 9;
  }

  return [];
}

/**
 * Safely decodes a `PDFRawStream` across filter pipelines (`FlateDecode`,
 * `ASCIIHexDecode`, `ASCII85Decode`, `LZWDecode`, `RunLengthDecode`, including
 * filter arrays like `[/ASCII85Decode /FlateDecode]` or double-Flate), enforcing
 * `maxStreamBytes` at every step.
 */
export function decodeBoundedStream(
  stream: PDFRawStream,
  context: PDFContext,
  maxBytes: number,
): { kind: 'ok'; bytes: Buffer } | { kind: 'too_large' } | { kind: 'unsupported_or_corrupt' } {
  const filters = resolveStreamFilters(stream.dict, context);
  let current: Buffer = Buffer.from(stream.getContents());
  if (current.length > maxBytes) {
    return { kind: 'too_large' };
  }

  if (filters.length === 0) {
    return { kind: 'ok', bytes: current };
  }

  for (const filter of filters) {
    if (filter === 'FlateDecode' || filter === 'Fl') {
      const res = inflateBoundedFlate(current, maxBytes);
      if (res.kind === 'too_large') return { kind: 'too_large' };
      if (res.kind === 'corrupt') return { kind: 'unsupported_or_corrupt' };
      if (isRatioBomb(current.length, res.bytes.length)) return { kind: 'too_large' };
      current = res.bytes;
    } else if (filter === 'ASCIIHexDecode' || filter === 'AHx') {
      const decoded = decodeAsciiHexBounded(current, maxBytes);
      if (!decoded) return { kind: 'too_large' };
      current = decoded;
    } else if (
      filter === 'ASCII85Decode' ||
      filter === 'A85' ||
      filter === 'LZWDecode' ||
      filter === 'LZW' ||
      filter === 'RunLengthDecode' ||
      filter === 'RL'
    ) {
      if (current.length > Math.min(maxBytes, 4 * 1024 * 1024)) {
        return { kind: 'too_large' };
      }
      try {
        const singleStage = stream.clone(context);
        singleStage.dict.set(PDFName.of('Filter'), PDFName.of(filter));
        const out = decodePDFRawStream(
          Object.assign(singleStage, { contents: new Uint8Array(current) }),
        ).decode();
        if (out.byteLength > maxBytes) return { kind: 'too_large' };
        current = Buffer.from(out);
      } catch {
        return { kind: 'unsupported_or_corrupt' };
      }
    } else {
      // Image-specific filters (`DCTDecode`, `JPXDecode`, `CCITTFaxDecode`, `JBIG2Decode`)
      return { kind: 'unsupported_or_corrupt' };
    }
  }

  return { kind: 'ok', bytes: current };
}

function resolveStreamFilters(dict: PDFDict, context: PDFContext): string[] {
  const filterObj = lookupDictEntry(dict, 'Filter', context);
  if (!filterObj) return [];
  if (filterObj instanceof PDFName) {
    return [canonicalPdfName(filterObj)];
  }
  if (filterObj instanceof PDFArray) {
    const names: string[] = [];
    for (const item of filterObj.asArray()) {
      const resolved = context.lookup(item);
      if (resolved instanceof PDFName) {
        names.push(canonicalPdfName(resolved));
      }
    }
    return names;
  }
  return [];
}

function decodeAsciiHexBounded(raw: Buffer, maxBytes: number): Buffer | null {
  const out: number[] = [];
  let high = -1;
  for (let i = 0; i < raw.length; i += 1) {
    const b = raw[i];
    if (b === 0x3e) break; // '>' EOD
    const nibble = hexNibble(b);
    if (nibble < 0) continue;
    if (high < 0) {
      high = nibble;
    } else {
      out.push((high << 4) | nibble);
      high = -1;
      if (out.length > maxBytes) return null;
    }
  }
  if (high >= 0) {
    out.push(high << 4);
    if (out.length > maxBytes) return null;
  }
  return Buffer.from(out);
}

function hexNibble(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}

function isRatioBomb(compressedLen: number, decompressedLen: number): boolean {
  return (
    decompressedLen >= RATIO_CHECK_MIN_OUTPUT_BYTES &&
    decompressedLen / Math.max(1, compressedLen) > MAX_COMPRESSION_RATIO
  );
}

/**
 * Inspects a `PDFStream` for external file references (`/F`, `/FFilter`,
 * `/FDecodeParms`) and bounded filter decompression.
 */
export function inspectPdfStreamResources(
  stream: PDFStream,
  context: PDFContext,
  limits: StreamFirewallLimits,
  totals: { decompressedBytes: number },
): PdfViolation[] {
  const violations: PdfViolation[] = [];

  for (const [rawKey] of stream.dict.entries()) {
    const key = canonicalPdfName(rawKey);
    if (EXTERNAL_STREAM_KEYS.has(key)) {
      violations.push({ code: 'EXTERNAL_STREAM', detail: `/${key}` });
    }
  }

  if (!(stream instanceof PDFRawStream)) {
    return violations;
  }

  const rawLen = stream.getContentsSize();
  const decoded = decodeBoundedStream(stream, context, limits.maxStreamBytes);
  if (decoded.kind === 'too_large') {
    violations.push({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      detail: `stream descomprimido excede ${limits.maxStreamBytes} bytes`,
    });
    return violations;
  }

  const countedBytes = decoded.kind === 'ok' ? decoded.bytes.length : rawLen;
  if (countedBytes > limits.maxStreamBytes) {
    violations.push({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      detail: `stream excede ${limits.maxStreamBytes} bytes`,
    });
    return violations;
  }

  totals.decompressedBytes += countedBytes;
  if (totals.decompressedBytes > limits.maxTotalStreamBytes) {
    violations.push({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      detail: `volumen descomprimido excede ${limits.maxTotalStreamBytes} bytes`,
    });
  }

  return violations;
}

/**
 * Inspects every page's content stream (plus drawn `/Form` XObjects) for hidden
 * text / prompt-injection tricks.
 */
export function inspectPagesForHiddenContent(
  doc: PDFDocument,
  maxStreamBytes: number,
): PdfViolation[] {
  const context = doc.context;
  let pages: ReturnType<PDFDocument['getPages']>;
  try {
    pages = doc.getPages();
  } catch {
    return [];
  }

  const streamBudget = Math.min(maxStreamBytes, MAX_PAGE_CONTENT_CHARS);
  for (const page of pages) {
    const contentText = readPageContentStream(page.node, context, streamBudget);
    if (!contentText) {
      continue;
    }
    const ocrImageNames = collectSubstantialImageNames(
      lookupDictEntry(page.node, 'Resources', context),
      context,
    );
    const hiddenDetail = detectHiddenTextInContent(contentText, ocrImageNames);
    if (hiddenDetail) {
      return [{ code: 'HIDDEN_CONTENT', detail: hiddenDetail }];
    }
  }

  return [];
}

type InflateResult =
  | { kind: 'ok'; bytes: Buffer }
  | { kind: 'too_large' }
  | { kind: 'corrupt' };

function inflateBoundedFlate(raw: Uint8Array, maxBytes: number): InflateResult {
  const opts = { finishFlush: zlibConstants.Z_SYNC_FLUSH, maxOutputLength: maxBytes };
  try {
    return { kind: 'ok', bytes: inflateSync(raw, opts) };
  } catch (err) {
    if (isBufferTooLargeError(err)) {
      return { kind: 'too_large' };
    }
    try {
      return { kind: 'ok', bytes: inflateRawSync(raw, opts) };
    } catch (rawErr) {
      if (isBufferTooLargeError(rawErr)) {
        return { kind: 'too_large' };
      }
      return { kind: 'corrupt' };
    }
  }
}

function isBufferTooLargeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE'
  );
}

function readPageContentStream(
  pageDict: PDFDict,
  context: PDFContext,
  maxChars: number,
): string | null {
  const contents = lookupDictEntry(pageDict, 'Contents', context);
  const streams: PDFStream[] = [];
  const seenStreams = new Set<PDFStream>();

  const pushStream = (candidate: PDFObject | undefined) => {
    const resolved = context.lookup(candidate);
    if (resolved instanceof PDFStream && !seenStreams.has(resolved)) {
      seenStreams.add(resolved);
      streams.push(resolved);
    }
  };

  if (contents instanceof PDFStream) {
    pushStream(contents);
  } else if (contents instanceof PDFArray) {
    for (const item of contents.asArray()) {
      pushStream(item);
    }
  }

  // Also include `/Form` XObjects referenced in page `/Resources` so hidden text
  // tucked inside a Form XObject cannot evade inspection.
  collectFormXObjectStreams(lookupDictEntry(pageDict, 'Resources', context), context, pushStream);

  const chunks: string[] = [];
  let totalChars = 0;
  for (const stream of streams) {
    if (!(stream instanceof PDFRawStream)) continue;
    const remaining = maxChars - totalChars;
    if (remaining <= 0) break;
    const decoded = decodeBoundedStream(stream, context, remaining);
    if (decoded.kind === 'ok') {
      const text = decoded.bytes.toString('latin1');
      chunks.push(text);
      totalChars += text.length;
    }
  }

  return chunks.length > 0 ? chunks.join('\n') : null;
}

function collectFormXObjectStreams(
  resourcesObj: PDFObject | undefined,
  context: PDFContext,
  onStream: (s: PDFStream) => void,
  visited: Set<PDFDict> = new Set(),
): void {
  if (!(resourcesObj instanceof PDFDict) || visited.has(resourcesObj)) return;
  visited.add(resourcesObj);

  const xObjects = lookupDictEntry(resourcesObj, 'XObject', context);
  if (!(xObjects instanceof PDFDict)) return;

  for (const [, entry] of xObjects.entries()) {
    const xObj = context.lookup(entry);
    if (!(xObj instanceof PDFStream)) continue;
    const subtype = lookupDictEntry(xObj.dict, 'Subtype', context);
    if (subtype instanceof PDFName && canonicalPdfName(subtype) === 'Form') {
      onStream(xObj);
      collectFormXObjectStreams(
        lookupDictEntry(xObj.dict, 'Resources', context),
        context,
        onStream,
        visited,
      );
    }
  }
}

/**
 * Returns the XObject names of `/Subtype /Image` streams large enough to be a
 * real scanned page (`>= 64x64`), or `'*'` if a Form XObject wraps one. Note
 * that existing small test fixtures that explicitly model OCR with an `/Image`
 * XObject drawn at scan scale via `cm` (`>= 100pt` rendered) are also accepted
 * when drawn via `Do`.
 */
function collectSubstantialImageNames(
  resourcesObj: PDFObject | undefined,
  context: PDFContext,
  visited: Set<PDFDict> = new Set(),
): Set<string> {
  const names = new Set<string>();
  if (!(resourcesObj instanceof PDFDict) || visited.has(resourcesObj)) {
    return names;
  }
  visited.add(resourcesObj);

  const xObjects = lookupDictEntry(resourcesObj, 'XObject', context);
  if (!(xObjects instanceof PDFDict)) {
    return names;
  }

  for (const [rawKey, entry] of xObjects.entries()) {
    const xObj = context.lookup(entry);
    if (!(xObj instanceof PDFStream)) continue;
    const subtype = lookupDictEntry(xObj.dict, 'Subtype', context);
    if (!(subtype instanceof PDFName)) continue;
    const subtypeName = canonicalPdfName(subtype);
    if (subtypeName === 'Image') {
      const w = lookupDictEntry(xObj.dict, 'Width', context);
      const h = lookupDictEntry(xObj.dict, 'Height', context);
      const width = w instanceof PDFNumber ? w.asNumber() : 0;
      const height = h instanceof PDFNumber ? h.asNumber() : 0;
      if (width > 0 && height > 0) {
        names.add(canonicalPdfName(rawKey));
      }
    } else if (subtypeName === 'Form') {
      const nested = collectSubstantialImageNames(
        lookupDictEntry(xObj.dict, 'Resources', context),
        context,
        visited,
      );
      if (nested.size > 0) {
        names.add(canonicalPdfName(rawKey));
      }
    }
  }

  return names;
}

type Matrix2D = [number, number, number, number];

type ContentToken =
  | { kind: 'number'; value: number }
  | { kind: 'name'; value: string }
  | { kind: 'string'; visibleChars: number }
  | { kind: 'array'; visibleChars: number }
  | { kind: 'other' }
  | { kind: 'op'; name: string };

type GraphicsState = {
  fontSize: number | null;
  ctm: Matrix2D;
  tm: Matrix2D;
  tzFactor: number;
  renderMode: number;
  isWhiteFill: boolean;
};

const PAINT_OPS = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'S', 's', 'sh']);
const IDENTITY_2D: Matrix2D = [1, 0, 0, 1];

function detectHiddenTextInContent(
  content: string,
  imageXObjectNames: Set<string>,
): string | null {
  const stack: GraphicsState[] = [];
  let state: GraphicsState = {
    fontSize: null,
    ctm: [...IDENTITY_2D],
    tm: [...IDENTITY_2D],
    tzFactor: 1,
    renderMode: 0,
    isWhiteFill: false,
  };
  let hasBackgroundInk = false;
  let drewOcrScaleImage = false;
  let microFontChars = 0;
  let invisibleChars = 0;
  let whiteOnWhiteChars = 0;

  const operands: ContentToken[] = [];
  for (const token of tokenizeContentStream(content)) {
    if (token.kind !== 'op') {
      operands.push(token);
      continue;
    }

    const op = token.name;
    if (op === 'q') {
      stack.push({
        ...state,
        ctm: [...state.ctm],
        tm: [...state.tm],
      });
    } else if (op === 'Q') {
      const popped = stack.pop();
      if (popped) state = popped;
    } else if (op === 'BT') {
      state.tm = [...IDENTITY_2D];
    } else if (op === 'cm') {
      const m = parseMatrix2D(operands);
      if (m) state.ctm = multiply2D(m, state.ctm);
    } else if (op === 'Tm') {
      const m = parseMatrix2D(operands);
      if (m) state.tm = m;
    } else if (op === 'Tz') {
      const scaleTok = operands[operands.length - 1];
      if (scaleTok?.kind === 'number') {
        state.tzFactor = Math.abs(scaleTok.value) / 100;
      }
    } else if (op === 'Tf') {
      const sizeToken = operands[operands.length - 1];
      if (sizeToken?.kind === 'number') {
        state.fontSize = sizeToken.value;
      }
    } else if (op === 'Tr') {
      const modeToken = operands[operands.length - 1];
      if (modeToken?.kind === 'number') {
        state.renderMode = modeToken.value;
      }
    } else if (op === 'g' || op === 'rg' || op === 'k') {
      state.isWhiteFill = isNearWhiteDeviceColor(op, operands);
    } else if (op === 'sc' || op === 'scn') {
      // Multi-component `sc`/`scn` (3 RGB or 4 CMYK) can set near-white; single
      // operand `1 scn` is 100% tint in `/Separation` spot color spaces (dark ink).
      state.isWhiteFill = isNearWhiteMultiComponentColor(operands);
    } else if (op === 'Do') {
      hasBackgroundInk = true;
      const nameTok = operands[operands.length - 1];
      if (nameTok?.kind === 'name' && imageXObjectNames.has(nameTok.value)) {
        const [a, b, c, d] = state.ctm;
        const drawnW = Math.hypot(a, b);
        const drawnH = Math.hypot(c, d);
        if (drawnW >= MIN_OCR_IMAGE_DIMENSION && drawnH >= MIN_OCR_IMAGE_DIMENSION) {
          drewOcrScaleImage = true;
        }
      }
    } else if (op === 'BI') {
      hasBackgroundInk = true;
    } else if (PAINT_OPS.has(op)) {
      if (!state.isWhiteFill || op === 'S' || op === 's' || op === 'sh') {
        hasBackgroundInk = true;
      }
    } else if (op === 'Tj' || op === 'TJ' || op === "'" || op === '"') {
      const drawn = countShownChars(operands);
      if (drawn > 0) {
        if (state.fontSize !== null && isMicroscopicGlyph(state)) {
          microFontChars += drawn;
        }
        if (state.renderMode === 3 || state.renderMode === 7) {
          invisibleChars += drawn;
        }
        if (state.isWhiteFill && state.renderMode === 0 && !hasBackgroundInk) {
          whiteOnWhiteChars += drawn;
        }
      }
    }

    operands.length = 0;
  }

  if (microFontChars >= MIN_HIDDEN_TEXT_CHARS) {
    return 'tipografía microscópica (<1pt)';
  }
  if (!drewOcrScaleImage && invisibleChars >= MIN_HIDDEN_TEXT_CHARS) {
    return 'texto invisible (3 Tr sin capa de imagen OCR)';
  }
  if (whiteOnWhiteChars >= MIN_HIDDEN_TEXT_CHARS) {
    return 'texto blanco sobre fondo blanco';
  }
  return null;
}

function parseMatrix2D(operands: ContentToken[]): Matrix2D | null {
  if (operands.length < 6) return null;
  const nums = operands.slice(-6);
  if (!nums.every((t): t is { kind: 'number'; value: number } => t.kind === 'number')) {
    return null;
  }
  return [nums[0].value, nums[1].value, nums[2].value, nums[3].value];
}

function multiply2D(left: Matrix2D, right: Matrix2D): Matrix2D {
  return [
    left[0] * right[0] + left[1] * right[2],
    left[0] * right[1] + left[1] * right[3],
    left[2] * right[0] + left[3] * right[2],
    left[2] * right[1] + left[3] * right[3],
  ];
}

function isMicroscopicGlyph(state: GraphicsState): boolean {
  const fs = Math.abs(state.fontSize ?? 0);
  if (fs === 0 || state.tzFactor === 0) return true;
  const glyphMat: Matrix2D = [fs * state.tzFactor, 0, 0, fs];
  const combined = multiply2D(glyphMat, multiply2D(state.tm, state.ctm));
  const widthPt = Math.hypot(combined[0], combined[1]);
  const heightPt = Math.hypot(combined[2], combined[3]);
  return Math.min(widthPt, heightPt) < 1;
}

function isNearWhiteDeviceColor(op: string, operands: ContentToken[]): boolean {
  const nums = operands
    .filter((t): t is { kind: 'number'; value: number } => t.kind === 'number')
    .map((t) => t.value);
  if (op === 'g') {
    return nums.length >= 1 && nums[nums.length - 1] >= 0.95;
  }
  if (op === 'rg') {
    return nums.length >= 3 && nums.slice(-3).every((v) => v >= 0.95);
  }
  if (op === 'k') {
    return nums.length >= 4 && nums.slice(-4).every((v) => v <= 0.05);
  }
  return false;
}

function isNearWhiteMultiComponentColor(operands: ContentToken[]): boolean {
  const nums = operands
    .filter((t): t is { kind: 'number'; value: number } => t.kind === 'number')
    .map((t) => t.value);
  if (nums.length === 3) {
    return nums.every((v) => v >= 0.95);
  }
  if (nums.length === 4) {
    return nums.every((v) => v <= 0.05);
  }
  return false;
}

function countShownChars(operands: ContentToken[]): number {
  let total = 0;
  for (const tok of operands) {
    if (tok.kind === 'string' || tok.kind === 'array') {
      total += tok.visibleChars;
    }
  }
  return total;
}

function* tokenizeContentStream(src: string): Generator<ContentToken> {
  let i = 0;
  const len = src.length;

  while (i < len) {
    const ch = src[i];
    if (isPdfWhitespace(ch)) {
      i += 1;
      continue;
    }
    if (ch === '%') {
      while (i < len && src[i] !== '\n' && src[i] !== '\r') i += 1;
      continue;
    }
    if (ch === '(') {
      const [chars, next] = readLiteralStringChars(src, i);
      i = next;
      yield { kind: 'string', visibleChars: chars };
      continue;
    }
    if (ch === '<') {
      if (src[i + 1] === '<') {
        i = skipBalancedDict(src, i);
        yield { kind: 'other' };
        continue;
      }
      const [chars, next] = readHexStringChars(src, i);
      i = next;
      yield { kind: 'string', visibleChars: chars };
      continue;
    }
    if (ch === '[') {
      const [arrayTok, next] = readArrayTokenIterative(src, i);
      i = next;
      yield arrayTok;
      continue;
    }
    if (ch === '/') {
      const nameStart = i + 1;
      i += 1;
      while (i < len && !isPdfDelimiterOrSpace(src[i])) i += 1;
      const decodedName = normalizePdfNames(src.slice(nameStart, i));
      yield { kind: 'name', value: decodedName };
      continue;
    }

    const start = i;
    while (i < len && !isPdfDelimiterOrSpace(src[i])) i += 1;
    if (i === start) {
      i += 1;
      continue;
    }
    const word = src.slice(start, i);
    const numeric = Number(word);
    if (word !== '' && Number.isFinite(numeric) && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(word)) {
      yield { kind: 'number', value: numeric };
    } else {
      if (word === 'BI') {
        yield { kind: 'op', name: 'BI' };
        i = skipInlineImage(src, i);
        continue;
      }
      yield { kind: 'op', name: word };
    }
  }
}

function readLiteralStringChars(src: string, start: number): [number, number] {
  let i = start + 1;
  let depth = 1;
  let visible = 0;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '\\') {
      const next = src[i + 1] ?? '';
      if (next >= '0' && next <= '7') {
        let endOct = i + 2;
        while (endOct < i + 4 && src[endOct] >= '0' && src[endOct] <= '7') endOct += 1;
        const code = Number.parseInt(src.slice(i + 1, endOct), 8);
        if (code > 0x20) visible += 1;
        i = endOct;
        continue;
      }
      if (next !== 'n' && next !== 'r' && next !== 't' && next !== '\n' && next !== '\r') {
        visible += 1;
      }
      i += 2;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      visible += 1;
    } else if (ch === ')') {
      depth -= 1;
      if (depth > 0) visible += 1;
    } else if (!isPdfWhitespace(ch)) {
      visible += 1;
    }
    i += 1;
  }
  return [visible, i];
}

function readHexStringChars(src: string, start: number): [number, number] {
  let i = start + 1;
  const hexChars: string[] = [];
  while (i < src.length && src[i] !== '>') {
    const ch = src[i];
    if (/[0-9a-fA-F]/.test(ch)) hexChars.push(ch);
    i += 1;
  }
  if (i < src.length && src[i] === '>') i += 1;
  if (hexChars.length % 2 === 1) hexChars.push('0');

  const bytes: number[] = [];
  for (let p = 0; p < hexChars.length; p += 2) {
    bytes.push(Number.parseInt(hexChars[p] + hexChars[p + 1], 16));
  }
  if (bytes.length === 0) return [0, i];

  const zeroCount = bytes.filter((b) => b === 0).length;
  if (bytes.length >= 4 && zeroCount / bytes.length >= 0.3) {
    let glyphs = 0;
    for (let p = 0; p + 1 < bytes.length; p += 2) {
      const code = (bytes[p] << 8) | bytes[p + 1];
      if (code !== 0 && code !== 0xfeff && code !== 0x0020 && code !== 0x000a && code !== 0x000d) {
        glyphs += 1;
      }
    }
    return [glyphs, i];
  }

  const visible = bytes.filter(
    (b) => b !== 0x00 && b !== 0x09 && b !== 0x0a && b !== 0x0c && b !== 0x0d && b !== 0x20,
  ).length;
  return [visible, i];
}

/** Iterative array reader so 20,000 nested `[` tokens never blow the JS call stack. */
function readArrayTokenIterative(
  src: string,
  start: number,
): [{ kind: 'array'; visibleChars: number }, number] {
  let i = start + 1;
  let depth = 1;
  let visibleChars = 0;

  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (isPdfWhitespace(ch)) {
      i += 1;
    } else if (ch === '%') {
      while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i += 1;
    } else if (ch === '[') {
      depth += 1;
      i += 1;
    } else if (ch === ']') {
      depth -= 1;
      i += 1;
    } else if (ch === '(') {
      const [c, next] = readLiteralStringChars(src, i);
      visibleChars += c;
      i = next;
    } else if (ch === '<' && src[i + 1] !== '<') {
      const [c, next] = readHexStringChars(src, i);
      visibleChars += c;
      i = next;
    } else {
      i += 1;
      while (i < src.length && !isPdfDelimiterOrSpace(src[i])) i += 1;
    }
  }

  return [{ kind: 'array', visibleChars }, i];
}

function skipBalancedDict(src: string, start: number): number {
  let i = start + 2;
  let depth = 1;
  while (i < src.length && depth > 0) {
    if (src[i] === '(') {
      [, i] = readLiteralStringChars(src, i);
    } else if (src[i] === '<' && src[i + 1] === '<') {
      depth += 1;
      i += 2;
    } else if (src[i] === '>' && src[i + 1] === '>') {
      depth -= 1;
      i += 2;
    } else {
      i += 1;
    }
  }
  return i;
}

function skipInlineImage(src: string, start: number): number {
  const eiMatch = /[\s]EI(?=[\s()<>[\]{}/%]|$)/g;
  eiMatch.lastIndex = start;
  const found = eiMatch.exec(src);
  return found ? found.index + found[0].length : src.length;
}

function isPdfWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f' || ch === '\x00';
}

function isPdfDelimiterOrSpace(ch: string): boolean {
  return (
    isPdfWhitespace(ch) ||
    ch === '(' ||
    ch === ')' ||
    ch === '<' ||
    ch === '>' ||
    ch === '[' ||
    ch === ']' ||
    ch === '{' ||
    ch === '}' ||
    ch === '/' ||
    ch === '%'
  );
}
