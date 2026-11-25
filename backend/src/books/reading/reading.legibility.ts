import type { BookReadingDocument } from './reading.types.js';

const SAMPLE_CHAR_LIMIT = 20_000;
const MIN_SAMPLE_NON_WS = 80;
const MIN_ALPHA_RATIO = 0.35;
const MIN_REAL_WORD_RATIO = 0.2;
const MAX_REPLACEMENT_RATIO = 0.05;

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

function countReplacementOrControlChars(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (
      code === 0xfffd ||
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f)
    ) {
      count += 1;
    }
  }
  return count;
}

/**
 * Deterministic legibility gate: detects broken `/ToUnicode` CMaps (glyph-shifted
 * ASCII punctuation like `"#$%&' (((((`) and replacement-character floods
 * before a file is persisted or served in Vigilia.
 */
export function assessTextLegibility(rawText: string): LegibilityVerdict {
  const sample = rawText.slice(0, SAMPLE_CHAR_LIMIT);
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

  if (
    totalNonWs >= MIN_SAMPLE_NON_WS &&
    (alphaRatio < MIN_ALPHA_RATIO || realWordRatio < MIN_REAL_WORD_RATIO)
  ) {
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

/** Evaluates legibility across the extracted chunks of a `BookReadingDocument`. */
export function assessReadingLegibility(document: BookReadingDocument): LegibilityVerdict {
  if (document.chunks.length === 0) {
    return assessTextLegibility('');
  }
  const combined = document.chunks.map((c) => c.text).join('\n');
  return assessTextLegibility(combined);
}
