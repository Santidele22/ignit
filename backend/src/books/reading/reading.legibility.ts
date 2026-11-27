import type { BookReadingDocument } from './reading.types.js';

const SAMPLE_WINDOW_CHARS = 8_000;
const FULL_SCAN_LIMIT = 24_000;
const MIN_SAMPLE_NON_WS = 80;
const MIN_ALPHA_RATIO = 0.35;
const MIN_REAL_WORD_RATIO = 0.2;
const MAX_REPLACEMENT_RATIO = 0.05;
const MAX_MOJIBAKE_RATIO = 0.03;

export const EMPTY_READING_MESSAGE =
  'El archivo no contiene texto extraíble (PDF escaneado sin OCR o vacío). Convertilo con OCR o subí un EPUB/PDF con texto válido.';

export const ILLEGIBLE_READING_MESSAGE =
  'El archivo tiene texto ilegible (posible tabla de fuentes / ToUnicode corrupta). Convertilo con OCR o subí un EPUB/PDF con texto válido.';

export type LegibilityVerdict = {
  legible: boolean;
  empty: boolean;
  totalNonWs: number;
  alphaRatio: number;
  realWordRatio: number;
  replacementRatio: number;
  reason?: string;
};

/** Counts U+FFFD, ASCII/C1 control characters, Private Use Area glyphs, and non-characters. */
function countReplacementOrControlChars(text: string): number {
  let count = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      code === 0xfffd ||
      code === 0xfffe ||
      code === 0xffff ||
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0xe000 && code <= 0xf8ff) ||
      code >= 0xf0000
    ) {
      count += 1;
    }
  }
  return count;
}

const MOJIBAKE_SEQUENCE_RE =
  /(?:Ã[\u0080-\u00BF¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿]|Â[\u0080-\u00BF¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿]|â€[œ\u009D™˜¢¦€]|ï¿½)/g;

/** Builds up to 3 independent windows (start, middle, end) so mid-book corruption is caught. */
function windowsAcrossDocument(rawText: string): string[] {
  if (rawText.length <= FULL_SCAN_LIMIT) {
    return [rawText];
  }
  const head = rawText.slice(0, SAMPLE_WINDOW_CHARS);
  const midStart = Math.max(0, Math.floor((rawText.length - SAMPLE_WINDOW_CHARS) / 2));
  const middle = rawText.slice(midStart, midStart + SAMPLE_WINDOW_CHARS);
  const tail = rawText.slice(Math.max(0, rawText.length - SAMPLE_WINDOW_CHARS));
  return [head, middle, tail];
}

function assessSingleWindow(sample: string): LegibilityVerdict {
  const nonWs = sample.replace(/\s+/g, '');
  const totalNonWs = nonWs.length;

  if (totalNonWs === 0) {
    return {
      legible: true,
      empty: true,
      totalNonWs: 0,
      alphaRatio: 1,
      realWordRatio: 1,
      replacementRatio: 0,
    };
  }

  const letters = nonWs.match(/\p{L}/gu)?.length ?? 0;
  const replacements = countReplacementOrControlChars(nonWs);
  const alphaRatio = letters / totalNonWs;
  const replacementRatio = replacements / totalNonWs;

  const tokens = sample
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 2);
  const realWords = tokens.filter((token) => /\p{L}{2,}/u.test(token)).length;
  const realWordRatio = tokens.length > 0 ? realWords / tokens.length : 1;

  if (replacementRatio > MAX_REPLACEMENT_RATIO) {
    return {
      legible: false,
      empty: false,
      totalNonWs,
      alphaRatio,
      realWordRatio,
      replacementRatio,
      reason: ILLEGIBLE_READING_MESSAGE,
    };
  }

  const mojibakeMatches = sample.match(MOJIBAKE_SEQUENCE_RE)?.length ?? 0;
  if (tokens.length >= 20 && mojibakeMatches / tokens.length > MAX_MOJIBAKE_RATIO) {
    return {
      legible: false,
      empty: false,
      totalNonWs,
      alphaRatio,
      realWordRatio,
      replacementRatio,
      reason: ILLEGIBLE_READING_MESSAGE,
    };
  }

  if (totalNonWs < MIN_SAMPLE_NON_WS) {
    return {
      legible: true,
      empty: true,
      totalNonWs,
      alphaRatio,
      realWordRatio,
      replacementRatio,
    };
  }

  if (alphaRatio < MIN_ALPHA_RATIO || realWordRatio < MIN_REAL_WORD_RATIO) {
    return {
      legible: false,
      empty: false,
      totalNonWs,
      alphaRatio,
      realWordRatio,
      replacementRatio,
      reason: ILLEGIBLE_READING_MESSAGE,
    };
  }

  return {
    legible: true,
    empty: false,
    totalNonWs,
    alphaRatio,
    realWordRatio,
    replacementRatio,
  };
}

/**
 * Deterministic legibility gate: detects broken `/ToUnicode` CMaps (glyph-shifted
 * ASCII punctuation like `"#$%&' (((((`), Private Use Area/replacement-character
 * floods, and UTF-8 mojibake across start, middle, and end of the document.
 * Empty/near-empty text is flagged via `empty: true` so the upload gate can
 * reject it with `EMPTY_READING_MESSAGE`.
 */
export function assessTextLegibility(rawText: string): LegibilityVerdict {
  const windows = windowsAcrossDocument(rawText);
  let firstVerdict: LegibilityVerdict | null = null;
  for (const win of windows) {
    const verdict = assessSingleWindow(win);
    if (!firstVerdict) firstVerdict = verdict;
    if (!verdict.legible) {
      return verdict;
    }
  }
  return firstVerdict ?? assessSingleWindow('');
}

/** Evaluates legibility across the extracted chunks of a `BookReadingDocument`. */
export function assessReadingLegibility(document: BookReadingDocument): LegibilityVerdict {
  if (document.chunks.length === 0) {
    return assessTextLegibility('');
  }
  const combined = document.chunks.map((c) => c.text).join('\n');
  return assessTextLegibility(combined);
}
