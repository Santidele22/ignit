import { describe, expect, it } from 'vitest';
import type { BookReadingDocument, ReadingChunk } from './reading.types.js';
import { normalizeReadingDocument } from './reading.normalizer.js';
import { READING_EXTRACTOR_VERSION } from './reading.types.js';

function chunk(overrides: Partial<ReadingChunk> & Pick<ReadingChunk, 'id' | 'type' | 'page' | 'text'>): ReadingChunk {
  return {
    offset: 0,
    mood: 'espera',
    cues: [],
    ...overrides,
  };
}

describe('reading.normalizer (canonical idempotent zone normalizer)', () => {
  it('is strictly idempotent: normalize(normalize(doc)) === normalize(doc)', () => {
    const doc: BookReadingDocument = {
      bookId: '53',
      pdfPages: 120,
      ocrPending: false,
      extractorVersion: 3,
      chunks: [
        chunk({ id: 'p0001.0000', type: 'heading', page: 1, text: 'c b Universidad Militar Bolivariana de Venezuela' }),
        chunk({ id: 'p0002.0000', type: 'toc', page: 2, text: 'Edición :\t1937\nLugar :\tMadrid' }),
        chunk({ id: 'p0002.0005', type: 'heading', page: 2, text: 'L . . ,' }),
        chunk({ id: 'p0002.0009', type: 'para', page: 2, text: '¡E !' }),
        chunk({ id: 'p0002.0015', type: 'toc', page: 2, text: 'D R\tD\nP :\t1637\nF :\tD\nE : E C , M ,\t1937\nT : M G\tM' }),
        chunk({ id: 'p0003.0000', type: 'heading', page: 3, text: 'ÍNDICE' }),
        chunk({ id: 'p0003.0010', type: 'quote', page: 3, text: 'Páginas' }),
        chunk({
          id: 'p0003.0020',
          type: 'para',
          page: 3,
          text: 'DEDICATORIA A LORENZO DE MÉDICIS. 7 CAPÍTULO PRIMERO.—De las clases de principados. 9 CAPÍTULO II.—De los principados hereditarios. 13',
        }),
        chunk({ id: 'p0004.0000', type: 'heading', page: 4, text: 'CAPÍTULO PRIMERO', level: 1 }),
        chunk({
          id: 'p0004.0020',
          type: 'para',
          page: 4,
          text: 'Todos los Estados, todas las dominaciones que han ejercido y ejercen soberanía sobre los hombres, han sido y son repúblicas o principados.',
        }),
        chunk({ id: 'p0120.0000', type: 'heading', page: 120, text: 'COLOFÓN' }),
      ],
    };

    const once = normalizeReadingDocument(doc);
    const twice = normalizeReadingDocument(once);

    expect(twice).toEqual(once);
    expect(once.extractorVersion).toBe(READING_EXTRACTOR_VERSION);
  });

  it('assigns frontmatter, toc, body, and backmatter zones, drops stripped-glyph noise, and preserves Roman I/V/X headings', () => {
    const doc: BookReadingDocument = {
      bookId: '53',
      pdfPages: 120,
      ocrPending: false,
      chunks: [
        chunk({ id: 'p0001.0000', type: 'heading', page: 1, text: 'c b Universidad Militar Bolivariana de Venezuela' }),
        chunk({ id: 'p0002.0000', type: 'toc', page: 2, text: 'Edición :\t1937\nLugar :\tMadrid' }),
        chunk({ id: 'p0002.0005', type: 'heading', page: 2, text: 'L . . ,' }),
        chunk({ id: 'p0002.0009', type: 'para', page: 2, text: '¡E !' }),
        chunk({ id: 'p0002.0015', type: 'toc', page: 2, text: 'D R\tD\nP :\t1637\nF :\tD\nE : E C , M ,\t1937\nT : M G\tM' }),
        chunk({ id: 'p0003.0000', type: 'heading', page: 3, text: 'ÍNDICE' }),
        chunk({ id: 'p0003.0010', type: 'quote', page: 3, text: 'Páginas' }),
        chunk({
          id: 'p0003.0020',
          type: 'para',
          page: 3,
          text: 'CAPÍTULO XV.—De las cosas por que los hombres merecen alabanza. 76 CAPÍTULO XVI.—De la liberalidad. 78',
        }),
        chunk({ id: 'p0004.0000', type: 'heading', page: 4, text: 'I', level: 1 }),
        chunk({
          id: 'p0004.0020',
          type: 'para',
          page: 4,
          text: 'Todos los Estados, todas las dominaciones que han ejercido y ejercen soberanía sobre los hombres, han sido y son repúblicas o principados.',
        }),
        chunk({ id: 'p0005.0000', type: 'heading', page: 5, text: 'D', level: 2 }),
        chunk({ id: 'p0120.0000', type: 'heading', page: 120, text: 'COLOFÓN' }),
      ],
    };

    const normalized = normalizeReadingDocument(doc);

    expect(normalized.chunks.find((c) => c.id === 'p0001.0000')).toMatchObject({
      type: 'meta',
      zone: 'frontmatter',
      text: 'Universidad Militar Bolivariana de Venezuela',
    });
    expect(normalized.chunks.find((c) => c.id === 'p0002.0000')).toMatchObject({
      type: 'meta',
      zone: 'frontmatter',
    });
    expect(normalized.chunks.find((c) => c.id === 'p0002.0005')).toBeUndefined();
    expect(normalized.chunks.find((c) => c.id === 'p0002.0009')).toBeUndefined();
    expect(normalized.chunks.find((c) => c.id === 'p0002.0015')).toBeUndefined();
    expect(normalized.chunks.find((c) => c.id === 'p0003.0010')).toBeUndefined();
    expect(normalized.chunks.find((c) => c.id === 'p0003.0020')).toMatchObject({
      type: 'toc',
      zone: 'toc',
    });
    expect(normalized.chunks.find((c) => c.id === 'p0003.0020')?.text).toContain(
      'CAPÍTULO XV.—De las cosas por que los hombres merecen alabanza\t76',
    );
    expect(normalized.chunks.find((c) => c.id === 'p0004.0000')).toMatchObject({
      type: 'heading',
      text: 'I',
      zone: 'body',
    });
    expect(normalized.chunks.find((c) => c.id === 'p0004.0020')?.zone).toBe('body');
    expect(normalized.chunks.find((c) => c.id === 'p0005.0000')).toBeUndefined();
    expect(normalized.chunks.find((c) => c.id === 'p0120.0000')?.zone).toBe('backmatter');
  });

  it('demotes long sentence-like headings to para and shell/git # comments to code', () => {
    const doc: BookReadingDocument = {
      bookId: '9',
      pdfPages: 20,
      ocrPending: false,
      chunks: [
        chunk({
          id: 'p0012.0000',
          type: 'heading',
          page: 12,
          level: 2,
          text: '# Please enter the commit message for your changes. Lines starting # with will be ignored.',
        }),
        chunk({
          id: 'p0013.0000',
          type: 'heading',
          page: 13,
          level: 2,
          text: 'Jonathan Harker, un joven agente inmobiliario, viaja a Transilvania para cerrar una venta con el conde Drácula.',
        }),
      ],
    };

    const once = normalizeReadingDocument(doc);
    const twice = normalizeReadingDocument(once);
    expect(twice).toEqual(once);
    expect(once.chunks[0]).toMatchObject({ type: 'code', zone: 'body' });
    expect(once.chunks[0].level).toBeUndefined();
    expect(once.chunks[1]).toMatchObject({ type: 'para', zone: 'body' });
    expect(once.chunks[1].level).toBeUndefined();
  });

  it('preserves 1-letter dialogue turns, compact initialisms, math/code expressions, verse linebreaks, and high Roman sequences', () => {
    const doc: BookReadingDocument = {
      bookId: '99',
      pdfPages: 60,
      ocrPending: false,
      chunks: [
        chunk({ id: 'p0011.0000', type: 'toc', page: 2, text: 'I\tv\nA\t1' }),
        chunk({ id: 'p0012.0000', type: 'heading', page: 12, text: 'XLIX', level: 1 }),
        chunk({ id: 'p0013.0000', type: 'heading', page: 13, text: 'L', level: 1 }),
        chunk({ id: 'p0014.0000', type: 'dialogue', page: 14, text: '—¿Y?' }),
        chunk({ id: 'p0014.0010', type: 'para', page: 14, text: 'O.K.' }),
        chunk({ id: 'p0014.0020', type: 'para', page: 14, text: 'a² + b² = c²' }),
        chunk({ id: 'p0014.0030', type: 'para', page: 14, text: 'i++;' }),
        chunk({
          id: 'p0015.0000',
          type: 'verse',
          page: 15,
          text: 'Aquí me pongo a cantar\nal compás de la vigüela',
        }),
      ],
    };

    const out = normalizeReadingDocument(doc);
    expect(out.chunks.map((c) => c.id)).toEqual([
      'p0011.0000',
      'p0012.0000',
      'p0013.0000',
      'p0014.0000',
      'p0014.0010',
      'p0014.0020',
      'p0014.0030',
      'p0015.0000',
    ]);
    expect(out.chunks.find((c) => c.id === 'p0015.0000')?.text).toBe(
      'Aquí me pongo a cantar\nal compás de la vigüela',
    );
  });
});
