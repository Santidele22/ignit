import { describe, expect, it } from 'vitest';
import type { BookReadingDocument } from './reading.types.js';
import { assessReadingLegibility, assessTextLegibility } from './reading.legibility.js';

function makeDoc(texts: string[]): BookReadingDocument {
  return {
    bookId: '1',
    pdfPages: 1,
    ocrPending: texts.length === 0,
    chunks: texts.map((text, idx) => ({
      id: `p0001.${String(idx).padStart(4, '0')}`,
      type: 'para' as const,
      page: 1,
      offset: idx * 100,
      text,
      mood: 'espera' as const,
      cues: [],
    })),
  };
}

describe('reading.legibility', () => {
  it('accepts normal Spanish literary prose', () => {
    const doc = makeDoc([
      'En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor.',
      'Una olla de algo más vaca que carnero, salpicón las más noches, duelos y quebrantos los sábados, lantejas los viernes, algún palomino de añadidura los domingos.',
    ]);
    const verdict = assessReadingLegibility(doc);
    expect(verdict.legible).toBe(true);
    expect(verdict.alphaRatio).toBeGreaterThan(0.7);
  });

  it('accepts technical books with code blocks and punctuation', () => {
    const doc = makeDoc([
      'Para manejar errores de forma idiomática en TypeScript conviene definir un tipo discriminado que represente éxito o falla explícitamente:',
      'export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };\n\nfunction parsePort(raw: string): Result<number> {\n  const n = Number.parseInt(raw, 10);\n  return Number.isInteger(n) && n > 0 ? { ok: true, value: n } : { ok: false, error: new Error("Invalid") };\n}',
    ]);
    const verdict = assessReadingLegibility(doc);
    expect(verdict.legible).toBe(true);
  });

  it('rejects broken ToUnicode / glyph-shifted mojibake from the screenshot', () => {
    const doc = makeDoc([
      '"#$%&\' $(!")*!',
      '!"#!$%&',
      '"#$%&\'&!((((((((((((((((((((((((((((((((((((((((((((((((((!(! *(!',
      '+,-./.0.,-12!.%!#.,+/343.,-&!((((((((((((((((((((((((((((((!5! 6(! 730+!0.!0.1/',
      '+,-.!1!((((((((((((((((((((((((((((((((((((((((((((((((((((!8! )(! .%!49-&0&!',
      '@3@%3&\'#+:;+(((((((((((((((((((((((((((((((((((((((((((((((!68! *(! .1-?03&1!\'..,#+%.1!1&@#.!%+!&@#++!0.!0.1/!+#-.1!((((((((((((!68!',
    ]);
    const verdict = assessReadingLegibility(doc);
    expect(verdict.legible).toBe(false);
    expect(verdict.reason).toContain('ilegible');
    expect(verdict.alphaRatio).toBeLessThan(0.2);
  });

  it('rejects replacement-character / control-glyph floods', () => {
    const garbage = '\uFFFD\uFFFD\uFFFD \uFFFD\uFFFD\uFFFD\uFFFD \uFFFD\uFFFD\uFFFD '.repeat(25);
    const verdict = assessTextLegibility(garbage);
    expect(verdict.legible).toBe(false);
  });

  it('does not falsely reject empty / ocrPending documents (handled separately)', () => {
    const emptyDoc = makeDoc([]);
    const verdict = assessReadingLegibility(emptyDoc);
    expect(verdict.legible).toBe(true);
    expect(verdict.empty).toBe(true);
  });
});
