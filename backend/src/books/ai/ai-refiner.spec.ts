import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BookReadingDocument, ReadingChunk } from '../reading/reading.types.js';
import { applyRefinementPatches, parseRefinerPatches } from './ai-refiner.parser.js';
import { selectRefinerCandidateBatches } from './ai-refiner.prompt.js';
import { refineReadingDocument } from './ai-refiner.service.js';

function makeChunk(overrides: Partial<ReadingChunk> & { id: string }): ReadingChunk {
  return {
    type: 'para',
    page: 1,
    offset: 0,
    text: 'Texto de ejemplo.',
    mood: 'espera',
    cues: [],
    ...overrides,
  };
}

function makeDoc(chunks: ReadingChunk[]): BookReadingDocument {
  return {
    bookId: '7',
    pdfPages: 3,
    ocrPending: false,
    extractorVersion: 3,
    chunks,
  };
}

function chatResponse(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

const ENV = {
  LLM_BASE_URL: 'https://api.nan.builders/v1',
  LLM_API_KEY: 'test-key',
  LLM_MODEL: 'deepseek-v4-flash',
} satisfies NodeJS.ProcessEnv;

describe('parseRefinerPatches', () => {
  it('parses fenced JSON patches and skips invalid entries', () => {
    const patches = parseRefinerPatches({
      choices: [
        {
          message: {
            content:
              '```json\n{"patches":[{"op":"reclassify","id":"c1","type":"heading","level":1},{"op":"reclassify","id":"bad","type":"not-a-type"},{"op":"merge","id":"c2"},{"op":"drop","id":"c3"}]}\n```',
          },
        },
      ],
    });

    expect(patches).toEqual([
      { op: 'reclassify', id: 'c1', type: 'heading', level: 1 },
      { op: 'merge', id: 'c2' },
      { op: 'drop', id: 'c3' },
    ]);
  });

  it('returns empty array on malformed payloads', () => {
    expect(parseRefinerPatches(null)).toEqual([]);
    expect(parseRefinerPatches({ choices: [{ message: { content: 'not json' } }] })).toEqual([]);
  });
});

describe('applyRefinementPatches', () => {
  it('reclassifies toc/headings, merges split page paragraphs, drops short headers, and never alters prose', () => {
    const doc = makeDoc([
      makeChunk({ id: 'c1', type: 'para', page: 1, text: 'Índice  Capítulo 1 .... 5' }),
      makeChunk({ id: 'c2', type: 'para', page: 2, text: 'Capítulo I: Los cimientos' }),
      makeChunk({ id: 'c3', type: 'para', page: 2, text: 'La arquitectura comienza cuando' }),
      makeChunk({ id: 'c4', type: 'para', page: 3, text: 'separamos los límites con claridad.' }),
      makeChunk({ id: 'c5', type: 'para', page: 3, text: 'Página 3' }),
    ]);

    const { document: refined, summary } = applyRefinementPatches(
      doc,
      [
        { op: 'reclassify', id: 'c1', type: 'toc' },
        { op: 'reclassify', id: 'c2', type: 'heading', level: 1 },
        { op: 'merge', id: 'c3' },
        { op: 'drop', id: 'c5' },
      ],
      'deepseek-v4-flash',
    );

    expect(summary).toEqual({
      applied: true,
      model: 'deepseek-v4-flash',
      reclassified: 2,
      merged: 1,
      dropped: 1,
      clutter: [
        {
          id: 'c5',
          page: 3,
          text: 'Página 3',
          reason: 'Ruido de maquetación o conversión',
          action: 'dropped',
        },
      ],
    });
    expect(refined.refinedByAi).toBe(true);
    expect(refined.chunks.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(refined.chunks[0]?.type).toBe('toc');
    expect(refined.chunks[1]).toMatchObject({ type: 'heading', level: 1 });
    expect(refined.chunks[2]?.text).toBe(
      'La arquitectura comienza cuando separamos los límites con claridad.',
    );
    // Original document remains untouched
    expect(doc.chunks).toHaveLength(5);
    expect(doc.refinedByAi).toBeUndefined();
  });

  it('blocks dropping long narrative paragraphs (> 200 chars) and caps drop ratio at 25%', () => {
    const longText = 'A'.repeat(250);
    const doc = makeDoc([
      makeChunk({ id: 'c1', text: longText }),
      makeChunk({ id: 'c2', text: 'Header 1' }),
      makeChunk({ id: 'c3', text: 'Header 2' }),
      makeChunk({ id: 'c4', text: 'Header 3' }),
      makeChunk({ id: 'c5', text: 'Body' }),
    ]);

    const { document: refined, summary } = applyRefinementPatches(doc, [
      { op: 'drop', id: 'c1' },
      { op: 'drop', id: 'c2' },
      { op: 'drop', id: 'c3' },
      { op: 'drop', id: 'c4' },
    ]);

    expect(summary.dropped).toBe(1);
    expect(refined.chunks.some((c) => c.id === 'c1')).toBe(true);
  });

  it('drops conversion clutter like ePUB v2.1 and records recommend_drop items without deleting them', () => {
    const doc = makeDoc([
      makeChunk({ id: 'c1', page: 1, text: '陰翳礼讃' }),
      makeChunk({ id: 'c2', page: 1, text: 'ePUB v2.1' }),
      makeChunk({ id: 'c3', page: 2, text: 'El elogio de la sombra comienza en la penumbra.' }),
    ]);

    const patches = parseRefinerPatches({
      choices: [
        {
          message: {
            content: JSON.stringify({
              patches: [
                { op: 'recommend_drop', id: 'c1', reason: 'Título suelto en idioma original' },
                { op: 'drop', id: 'c2', reason: 'Etiqueta de conversión ePUB' },
              ],
            }),
          },
        },
      ],
    });

    const { document: refined, summary } = applyRefinementPatches(doc, patches, 'deepseek-v4-flash');
    expect(refined.chunks.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(summary.clutter).toEqual([
      {
        id: 'c1',
        page: 1,
        text: '陰翳礼讃',
        reason: 'Título suelto en idioma original',
        action: 'recommended',
      },
      {
        id: 'c2',
        page: 1,
        text: 'ePUB v2.1',
        reason: 'Etiqueta de conversión ePUB',
        action: 'dropped',
      },
    ]);
  });
});

describe('selectRefinerCandidates & refineReadingDocument', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes cross-page split paragraphs even past front-matter', () => {
    const chunks: ReadingChunk[] = [];
    for (let i = 0; i < 45; i += 1) {
      chunks.push(
        makeChunk({
          id: `long-${i}`,
          page: i + 1,
          text: `${'Párrafo completo y cerrado. '.repeat(12)}Fin.`,
        }),
      );
    }
    chunks.push(
      makeChunk({
        id: 'split-a',
        page: 46,
        text: `${'Oración larga sin punto final '.repeat(8)}porque continúa`,
      }),
      makeChunk({
        id: 'split-b',
        page: 47,
        text: `${'en la página siguiente del capítulo. '.repeat(8)}Cierra acá.`,
      }),
    );

    const candidates = selectRefinerCandidateBatches(makeDoc(chunks)).flat();
    const ids = candidates.map((c) => c.id);
    expect(ids).toContain('split-a');
    expect(ids).toContain('split-b');
  });

  it('fails open when env is missing or fetch fails, and applies patches when LLM responds', async () => {
    const doc = makeDoc([
      makeChunk({ id: 'c1', type: 'para', text: 'Capítulo 1: Inicio' }),
      makeChunk({ id: 'c2', type: 'para', text: 'Contenido del libro.' }),
    ]);

    const noEnv = await refineReadingDocument(doc, { env: {} });
    expect(noEnv.summary.applied).toBe(false);
    expect(noEnv.document).toBe(doc);

    const fetchMock = vi.fn(async () =>
      chatResponse('{"patches":[{"op":"reclassify","id":"c1","type":"heading","level":1}]}'),
    );
    const ok = await refineReadingDocument(doc, { env: ENV, fetchImpl: fetchMock as unknown as typeof fetch });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ok.summary).toEqual({
      applied: true,
      model: 'deepseek-v4-flash',
      passes: 2,
      reclassified: 1,
      merged: 0,
      dropped: 0,
    });
    expect(ok.document.chunks[0]).toMatchObject({ type: 'heading', level: 1 });
  });

  it('runs a second design pass to catch residual unicode/clutter exposed after pass 1', async () => {
    const doc = makeDoc([
      makeChunk({ id: 'c1', type: 'para', text: 'Capítulo 1: Inicio' }),
      makeChunk({ id: 'c2', type: 'para', text: 'Contenido real del libro en español.' }),
      makeChunk({ id: 'c3', type: 'para', text: 'Ã±Ã¡Ã©Ã­Ã³' }),
    ]);

    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return chatResponse('{"patches":[{"op":"reclassify","id":"c1","type":"heading","level":1}]}');
      }
      return chatResponse('{"patches":[{"op":"drop","id":"c3","reason":"Artefacto Unicode corrupto"}]}');
    });

    const refined = await refineReadingDocument(doc, {
      env: ENV,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refined.summary).toMatchObject({
      applied: true,
      reclassified: 1,
      dropped: 1,
    });
    expect(refined.document.chunks.map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});
