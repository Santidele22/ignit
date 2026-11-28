import { describe, expect, it } from 'vitest';
import type { BookReadingDocument, ReadingChunk } from './reading.types.js';
import { normalizeReadingDocument } from './reading.normalizer.js';

function c(overrides: Partial<ReadingChunk> & Pick<ReadingChunk, 'id' | 'type' | 'page' | 'text'>): ReadingChunk {
  return { offset: 0, mood: 'espera', cues: [], ...overrides };
}

const ARCHETYPES: { name: string; doc: BookReadingDocument; assert: (out: BookReadingDocument) => void }[] = [
  {
    name: 'editorial EPUB novel (credits + dedication + chapter + dialogue)',
    doc: {
      bookId: 'arch-epub',
      pdfPages: 12,
      ocrPending: false,
      chunks: [
        c({ id: 'p0001.0000', type: 'para', page: 1, text: 'Prólogo y edición de David Roas' }),
        c({ id: 'p0001.0020', type: 'meta', page: 1, text: 'Traducción de Carlos Santos Sáez' }),
        c({ id: 'p0001.0050', type: 'dedication', page: 1, text: 'Para Edgar' }),
        c({ id: 'p0002.0000', type: 'heading', page: 2, text: 'CAPÍTULO I', level: 1 }),
        c({
          id: 'p0002.0020',
          type: 'para',
          page: 2,
          text: 'Durante todo un día de otoño, triste, oscuro y silencioso, cuando las nubes se cernían bajas y pesadas en el cielo.',
        }),
        c({ id: 'p0002.0120', type: 'dialogue', page: 2, text: '—¿Quién llama a esta hora? —preguntó Usher.' }),
      ],
    },
    assert: (out) => {
      expect(out.chunks.map((x) => [x.zone, x.type])).toEqual([
        ['frontmatter', 'para'],
        ['frontmatter', 'meta'],
        ['frontmatter', 'dedication'],
        ['body', 'heading'],
        ['body', 'para'],
        ['body', 'dialogue'],
      ]);
    },
  },
  {
    name: 'classic short-chapter essay (inline TOC + Roman chapters)',
    doc: {
      bookId: 'arch-essay',
      pdfPages: 80,
      ocrPending: false,
      chunks: [
        c({ id: 'p0002.0000', type: 'heading', page: 2, text: 'ÍNDICE' }),
        c({ id: 'p0002.0010', type: 'quote', page: 2, text: 'Páginas' }),
        c({
          id: 'p0002.0020',
          type: 'para',
          page: 2,
          text: 'CAPÍTULO PRIMERO.—De las clases de principados. 7 CAPÍTULO II.—De los principados hereditarios. 11',
        }),
        c({ id: 'p0003.0000', type: 'heading', page: 3, text: 'CAPÍTULO PRIMERO', level: 1 }),
        c({
          id: 'p0003.0020',
          type: 'para',
          page: 3,
          text: 'Todos los Estados que han ejercido soberanía sobre los hombres han sido y son repúblicas o principados.',
        }),
      ],
    },
    assert: (out) => {
      expect(out.chunks.some((x) => x.text === 'Páginas')).toBe(false);
      expect(out.chunks.find((x) => x.id === 'p0002.0020')).toMatchObject({ type: 'toc', zone: 'toc' });
      expect(out.chunks.find((x) => x.id === 'p0003.0000')?.zone).toBe('body');
    },
  },
  {
    name: 'technical book with code and captions',
    doc: {
      bookId: 'arch-tech',
      pdfPages: 40,
      ocrPending: false,
      chunks: [
        c({ id: 'p0001.0000', type: 'heading', page: 1, text: '1 · INTRODUCCIÓN', level: 1 }),
        c({ id: 'p0001.0020', type: 'code', page: 1, text: 'from math import sqrt\nprint(sqrt(16))' }),
        c({ id: 'p0001.0060', type: 'caption', page: 1, text: 'Figura 1-1. Raíz cuadrada en Python.' }),
      ],
    },
    assert: (out) => {
      expect(out.chunks.map((x) => [x.zone, x.type])).toEqual([
        ['body', 'heading'],
        ['body', 'code'],
        ['body', 'caption'],
      ]);
    },
  },
  {
    name: 'frontmatter-heavy institutional PDF',
    doc: {
      bookId: 'arch-inst',
      pdfPages: 30,
      ocrPending: false,
      chunks: [
        c({ id: 'p0001.0000', type: 'heading', page: 1, text: 'c b Universidad Militar Bolivariana de Venezuela' }),
        c({ id: 'p0002.0000', type: 'toc', page: 2, text: 'Edición :\t1937\nLugar :\tMadrid' }),
        c({ id: 'p0002.0005', type: 'toc', page: 2, text: 'D R\tD\nP :\t1637\nF :\tD' }),
        c({ id: 'p0003.0000', type: 'heading', page: 3, text: 'Índice' }),
        c({ id: 'p0003.0010', type: 'para', page: 3, text: '8 Presentación 10 Prólogo' }),
      ],
    },
    assert: (out) => {
      expect(out.chunks[0]).toMatchObject({ type: 'meta', zone: 'frontmatter', text: 'Universidad Militar Bolivariana de Venezuela' });
      expect(out.chunks[1]).toMatchObject({ type: 'meta', zone: 'frontmatter' });
      expect(out.chunks.find((x) => x.id === 'p0002.0005')).toBeUndefined();
      expect(out.chunks[3]).toMatchObject({ type: 'toc', zone: 'toc', text: 'Presentación\t8\nPrólogo\t10' });
    },
  },
  {
    name: 'historical scanned OCR book (Martín Fierro title page + stamps + prologue)',
    doc: {
      bookId: 'arch-historical-ocr',
      pdfPages: 152,
      ocrPending: false,
      chunks: [
        c({ id: 'p0005.0000', type: 'heading', page: 5, text: 'EL GAUCHO', level: 1 }),
        c({ id: 'p0005.0011', type: 'heading', page: 5, text: 'MARTIN FIERRO', level: 1 }),
        c({ id: 'p0005.0026', type: 'code', page: 5, text: 'POR\n\nJOSÉ HERNÁNDEZ' }),
        c({ id: 'p0005.0057', type: 'heading', page: 5, text: 'DÉCIMA QUINTA EDICIÓN', level: 1 }),
        c({
          id: 'p0005.0080',
          type: 'para',
          page: 5,
          text: 'CON UN TOTAL DE 64.000 EJEMPLARES EQUIVALENTES A 60 EDICIONES DE MIL NUMEROS CADA UNA',
        }),
        c({ id: 'p0005.0189', type: 'para', page: 5, text: 'CASA EDITORA Y DEPOSITO GENERAL' }),
        c({ id: 'p0006.0055', type: 'heading', page: 6, text: '\\BRA/t', level: 1 }),
        c({ id: 'p0006.0063', type: 'heading', page: 6, text: 'V · OCT 161968', level: 1 }),
        c({ id: 'p0006.0079', type: 'heading', page: 6, text: '^ITVOFlfi^', level: 1 }),
        c({
          id: 'p0009.0000',
          type: 'para',
          page: 9,
          text: 'Al ofrecer al público, esta vez, la décima quinta edición de la «Ida y Vuelta de Martin Fierro», creemos cumplir un deber editorial.',
        }),
      ],
    },
    assert: (out) => {
      expect(out.chunks.some((x) => x.type === 'code')).toBe(false);
      expect(out.chunks.some((x) => /OCT 161968|BRA\/t|ITVOFlfi/.test(x.text))).toBe(false);
      expect(
        out.chunks.some(
          (x) => x.type === 'meta' && x.zone === 'frontmatter' && x.text.includes('DÉCIMA QUINTA EDICIÓN'),
        ),
      ).toBe(true);
      expect(out.chunks.find((x) => x.id === 'p0009.0000')).toMatchObject({
        type: 'para',
        zone: 'body',
      });
    },
  },
];

describe('reading golden archetypes', () => {
  for (const arch of ARCHETYPES) {
    it(`normalizes ${arch.name} deterministically and idempotently`, () => {
      const once = normalizeReadingDocument(arch.doc);
      const twice = normalizeReadingDocument(once);
      expect(twice).toEqual(once);
      arch.assert(once);
    });
  }
});
