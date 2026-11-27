import { describe, expect, it } from 'vitest';
import type { BookReadingDocument } from './reading.types.js';
import {
  assessReadingLegibility,
  assessTextLegibility,
  EMPTY_READING_MESSAGE,
  hasPartialFontCorruption,
  ILLEGIBLE_READING_MESSAGE,
} from './reading.legibility.js';

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

  it('flags empty / zero-text documents with empty: true for the upload gate', () => {
    const emptyDoc = makeDoc([]);
    const verdict = assessReadingLegibility(emptyDoc);
    expect(verdict.legible).toBe(true);
    expect(verdict.empty).toBe(true);
  });

  it('flags near-empty documents below minimum readable length with empty: true', () => {
    const tinyDoc = makeDoc(['Página 1']);
    const verdict = assessReadingLegibility(tinyDoc);
    expect(verdict.legible).toBe(true);
    expect(verdict.empty).toBe(true);
  });

  it('rejects Private Use Area unicode floods and mojibake', () => {
    const pua = '\uE001\uE002\uE003 \uE004\uE005\uE006 '.repeat(20);
    expect(assessTextLegibility(pua)).toMatchObject({
      legible: false,
      reason: ILLEGIBLE_READING_MESSAGE,
    });

    const mojibake = 'La maÃ±ana frÃ­a de otoÃ±o tenÃ­a una extraÃ±a melancolÃ­a â€œenormeâ€ '.repeat(5);
    expect(assessTextLegibility(mojibake)).toMatchObject({
      legible: false,
      reason: ILLEGIBLE_READING_MESSAGE,
    });
  });

  it('catches corrupted ToUnicode appearing in the middle of a long book', () => {
    const cleanIntro = 'Capítulo uno de una historia clásica en español con prosa clara. '.repeat(220);
    const corruptedMiddle = '"#$%&\' $(!")*! +,-./.0.,-12!.%!#.,+/343.,-&!(((((((((((( '.repeat(250);
    const cleanOutro = 'Epílogo final del libro en español con palabras normales. '.repeat(220);
    const verdict = assessTextLegibility(`${cleanIntro}\n${corruptedMiddle}\n${cleanOutro}`);
    expect(verdict.legible).toBe(false);
    expect(verdict.reason).toBe(ILLEGIBLE_READING_MESSAGE);
  });

  it('detects localized partial font/small-caps corruption in headings', () => {
    const doc = {
      bookId: '58',
      pdfPages: 20,
      ocrPending: false,
      chunks: [
        { id: 'p0001.0000', type: 'heading' as const, page: 1, offset: 0, text: 'L . . ,', mood: 'espera' as const, cues: [] },
        { id: 'p0002.0000', type: 'heading' as const, page: 2, offset: 0, text: 'D', mood: 'espera' as const, cues: [] },
        { id: 'p0003.0000', type: 'heading' as const, page: 3, offset: 0, text: 'P', mood: 'espera' as const, cues: [] },
        { id: 'p0004.0000', type: 'heading' as const, page: 4, offset: 0, text: 'S', mood: 'espera' as const, cues: [] },
        { id: 'p0004.0010', type: 'para' as const, page: 4, offset: 10, text: 'El buen sentido es lo que mejor repartido está entre todo el mundo.', mood: 'espera' as const, cues: [] },
      ],
    };
    expect(hasPartialFontCorruption(doc)).toBe(true);
  });

  it('does not treat valid Roman numeral chapter headings as font corruption', () => {
    const doc = {
      bookId: '57',
      pdfPages: 20,
      ocrPending: false,
      chunks: [
        { id: 'p0001.0000', type: 'heading' as const, page: 1, offset: 0, text: 'I', mood: 'espera' as const, cues: [] },
        { id: 'p0002.0000', type: 'heading' as const, page: 2, offset: 0, text: 'II', mood: 'espera' as const, cues: [] },
        { id: 'p0003.0000', type: 'heading' as const, page: 3, offset: 0, text: 'V', mood: 'espera' as const, cues: [] },
        { id: 'p0004.0000', type: 'heading' as const, page: 4, offset: 0, text: 'X', mood: 'espera' as const, cues: [] },
      ],
    };
    expect(hasPartialFontCorruption(doc)).toBe(false);
  });
});
