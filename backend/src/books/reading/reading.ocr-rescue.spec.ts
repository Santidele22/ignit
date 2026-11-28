import { describe, expect, it } from 'vitest';
import type { BookReadingDocument, ReadingChunk } from './reading.types.js';
import {
  applySurgicalPageOcr,
  detectPagesNeedingSurgicalOcr,
  parseHocrToBlocks,
} from './reading.ocr-rescue.js';
import { extractReadingFromPdftohtmlXml } from './reading.xml-blocks.js';
import { normalizeReadingDocument } from './reading.normalizer.js';

function chunk(
  overrides: Partial<ReadingChunk> & Pick<ReadingChunk, 'id' | 'type' | 'page' | 'text'>,
): ReadingChunk {
  return {
    offset: 0,
    mood: 'espera',
    cues: [],
    ...overrides,
  };
}

describe('reading.ocr-rescue (surgical per-page OCR & OCR XML cleanup)', () => {
  it('detects only pages with stripped small-caps noise or truncated 1-letter non-Roman headings', () => {
    const doc: BookReadingDocument = {
      bookId: '58',
      pdfPages: 6,
      ocrPending: false,
      chunks: [
        chunk({ id: 'p0002.0000', type: 'heading', page: 2, text: 'L . . ,' }),
        chunk({ id: 'p0002.0009', type: 'para', page: 2, text: '¡E !' }),
        chunk({
          id: 'p0002.0015',
          type: 'toc',
          page: 2,
          text: 'D R\tD\nP :\t1637\nF :\tD\nE : E C , M ,\t1937\nT : M G\tM',
        }),
        chunk({ id: 'p0003.0000', type: 'heading', page: 3, text: 'D', level: 1 }),
        chunk({
          id: 'p0003.0010',
          type: 'para',
          page: 3,
          text: 'Prólogo para el Discurso del Método. Para bien dirigir la razón y buscar la verdad en las ciencias.',
          runs: [
            {
              text: 'Prólogo para el Discurso del Método. Para bien dirigir la razón y buscar la verdad en las ciencias.',
              marks: ['i'],
            },
          ],
        }),
        chunk({ id: 'p0003.0200', type: 'heading', page: 3, text: 'P', level: 2 }),
        chunk({
          id: 'p0004.0000',
          type: 'para',
          page: 4,
          text: 'El buen sentido es lo que mejor repartido está entre todo el mundo.',
        }),
        chunk({ id: 'p0005.0000', type: 'heading', page: 5, text: 'I', level: 1 }),
        chunk({
          id: 'p0005.0010',
          type: 'para',
          page: 5,
          text: 'Capítulo con numeración romana legítima que no debe disparar OCR.',
        }),
      ],
    };

    expect(detectPagesNeedingSurgicalOcr(doc)).toEqual([2, 3]);
  });

  it('surgically rescues truncated small-caps headings from page OCR while preserving native Unicode prose and runs', () => {
    const doc: BookReadingDocument = {
      bookId: '58',
      pdfPages: 4,
      ocrPending: false,
      chunks: [
        chunk({ id: 'p0002.0000', type: 'heading', page: 2, text: 'L . . ,' }),
        chunk({ id: 'p0002.0009', type: 'para', page: 2, text: '¡E !' }),
        chunk({
          id: 'p0002.0015',
          type: 'toc',
          page: 2,
          text: 'D R\tD\nP :\t1637\nF :\tD',
        }),
        chunk({ id: 'p0003.0000', type: 'heading', page: 3, text: 'D', level: 1 }),
        chunk({
          id: 'p0003.0010',
          type: 'para',
          page: 3,
          text: 'Prólogo para el Discurso del Método. Para bien dirigir la razón y buscar la verdad en las ciencias.',
          runs: [
            {
              text: 'Prólogo para el Discurso del Método. Para bien dirigir la razón y buscar la verdad en las ciencias.',
              marks: ['i'],
            },
          ],
        }),
        chunk({ id: 'p0003.0200', type: 'heading', page: 3, text: 'P', level: 2 }),
        chunk({
          id: 'p0004.0000',
          type: 'para',
          page: 4,
          text: 'El buen sentido es lo que mejor repartido está entre todo el mundo.',
        }),
      ],
    };

    const ocrByPage = new Map<number, string>([
      [
        2,
        [
          'www.lectulandia.com',
          '',
          'Discurso del metodo - Rene Descartes',
          'Edicion: Espasa Calpe, Madrid, 1937',
          'Traduccion: Manuel Garcia Morente',
        ].join('\n'),
      ],
      [
        3,
        [
          'DISCURSO DEL METODO',
          '',
          'Prologo para el Discurso del Metodo. Para bien dirigir la razon y buscar la verdad en las ciencias.',
          '',
          'PRIMERA PARTE',
        ].join('\n'),
      ],
    ]);

    const rescued = normalizeReadingDocument(applySurgicalPageOcr(doc, ocrByPage));

    expect(rescued.chunks.some((c) => c.text.includes('L . .'))).toBe(false);
    expect(rescued.chunks.some((c) => c.text.includes('¡E'))).toBe(false);
    expect(rescued.chunks.some((c) => c.text.includes('lectulandia'))).toBe(false);

    const p3Headings = rescued.chunks.filter((c) => c.page === 3 && c.type === 'heading');
    expect(p3Headings.map((h) => h.text)).toEqual(['DISCURSO DEL METODO', 'PRIMERA PARTE']);

    // Native accented prose + italic runs on page 3 remain untouched
    const p3Prose = rescued.chunks.find((c) => c.id === 'p0003.0010');
    expect(p3Prose?.text).toBe(
      'Prólogo para el Discurso del Método. Para bien dirigir la razón y buscar la verdad en las ciencias.',
    );
    expect(p3Prose?.runs).toEqual([
      {
        text: 'Prólogo para el Discurso del Método. Para bien dirigir la razón y buscar la verdad en las ciencias.',
        marks: ['i'],
      },
    ]);
  });

  it('strips 1.2x repeated two-line OCR running headers, merges jittered GlyphLessFont prose lines, and cleans pipe-bordered TOCs', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<pdf2xml producer="poppler" version="26.08.0">
<page number="2" position="absolute" top="0" left="0" height="893" width="630">
  <fontspec id="1" size="15" family="GlyphLessFont" color="#000000"/>
  <fontspec id="2" size="18" family="GlyphLessFont" color="#000000"/>
  <fontspec id="3" size="20" family="GlyphLessFont" color="#000000"/>
  <text top="53" left="230" width="176" height="15" font="1">Discurso Del Método</text>
  <text top="65" left="293" width="79" height="18" font="2">René Descartes</text>
  <text top="135" left="282" width="77" height="20" font="3">INDICE</text>
  <text top="349" left="116" width="104" height="18" font="2">POST SCRÍPTUM</text>
  <text top="349" left="491" width="18" height="18" font="2">24|</text>
  <text top="376" left="116" width="138" height="18" font="2">BIBLIOGRAFÍA..........</text>
  <text top="376" left="491" width="18" height="18" font="2">27|</text>
  <text top="530" left="115" width="286" height="18" font="2">TERCERA PARTE -.ncu.ceneneneno</text>
  <text top="530" left="491" width="19" height="18" font="2">51|</text>
</page>
<page number="3" position="absolute" top="0" left="0" height="893" width="630">
  <fontspec id="1" size="15" family="GlyphLessFont" color="#000000"/>
  <fontspec id="2" size="18" family="GlyphLessFont" color="#000000"/>
  <fontspec id="4" size="24" family="GlyphLessFont" color="#000000"/>
  <fontspec id="5" size="17" family="GlyphLessFont" color="#000000"/>
  <text top="53" left="230" width="176" height="15" font="1">Discurso Del Método</text>
  <text top="65" left="293" width="79" height="18" font="2">René Descartes</text>
  <text top="130" left="267" width="108" height="24" font="4">PRÓLOGO</text>
  <text top="611" left="115" width="435" height="15" font="1">Descartes inaugura la actitud filosófica que recibe el nombre de idealismo.</text>
  <text top="630" left="85" width="463" height="17" font="5">Desde entonces el idealismo domina sobre todo el</text>
  <text top="649" left="85" width="458" height="15" font="1">impulso y la dirección dados</text>
</page>
<page number="4" position="absolute" top="0" left="0" height="893" width="630">
  <fontspec id="1" size="15" family="GlyphLessFont" color="#000000"/>
  <fontspec id="2" size="18" family="GlyphLessFont" color="#000000"/>
  <text top="53" left="230" width="176" height="15" font="1">Discurso Del Método</text>
  <text top="65" left="293" width="79" height="18" font="2">René Descartes</text>
  <text top="128" left="86" width="467" height="15" font="1">por Descartes a la filosofía moderna durante tres siglos.</text>
</page>
</pdf2xml>`;

    const doc = normalizeReadingDocument(extractReadingFromPdftohtmlXml(58, xml));
    expect(doc.chunks.some((c) => c.text === 'René Descartes')).toBe(false);

    const toc = doc.chunks.find((c) => c.type === 'toc');
    expect(toc?.text).toContain('POST SCRÍPTUM\t24');
    expect(toc?.text).toContain('BIBLIOGRAFÍA\t27');
    expect(toc?.text).toContain('TERCERA PARTE\t51');

    // Cross-page + jittered-font paragraph merged into one clean paragraph
    const mergedPara = doc.chunks.find((c) => c.page === 3 && c.type === 'para');
    expect(mergedPara?.text).toContain('Desde entonces el idealismo domina');
    expect(mergedPara?.text).toContain('dados por Descartes a la filosofía moderna');
  });

  it('keeps unnumbered entries on an INDICE page inside toc zone, treats ordinal PARTE as L1, and keeps footnotes as para', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<pdf2xml producer="poppler" version="26.08.0">
<page number="2" position="absolute" top="0" left="0" height="893" width="630">
  <fontspec id="2" size="18" family="GlyphLessFont" color="#000000"/>
  <fontspec id="3" size="20" family="GlyphLessFont" color="#000000"/>
  <text top="135" left="282" width="77" height="20" font="3">INDICE</text>
  <text top="203" left="116" width="120" height="18" font="2">PRÓLOGO.....</text>
  <text top="476" left="116" width="160" height="18" font="2">PRIMERA PARTE ........</text>
</page>
<page number="32" position="absolute" top="0" left="0" height="893" width="630">
  <fontspec id="1" size="15" family="GlyphLessFont" color="#000000"/>
  <fontspec id="2" size="18" family="GlyphLessFont" color="#000000"/>
  <fontspec id="5" size="17" family="GlyphLessFont" color="#000000"/>
  <text top="140" left="230" width="170" height="18" font="2">PRIMERA PARTE</text>
  <text top="200" left="115" width="435" height="15" font="1">El buen sentido es lo que mejor repartido está entre todo el mundo.</text>
  <text top="760" left="85" width="400" height="17" font="5">6 Véase parte sexta de este Discurso.</text>
</page>
</pdf2xml>`;

    const doc = normalizeReadingDocument(extractReadingFromPdftohtmlXml(58, xml));
    const p2Headings = doc.chunks.filter((c) => c.page === 2 && c.type === 'heading');
    expect(p2Headings.map((h) => h.text)).toEqual(['INDICE']);
    expect(doc.chunks.filter((c) => c.page === 2).every((c) => c.zone === 'toc')).toBe(true);

    const p32Headings = doc.chunks.filter((c) => c.page === 32 && c.type === 'heading');
    expect(p32Headings).toHaveLength(1);
    expect(p32Headings[0]).toMatchObject({ text: 'PRIMERA PARTE', level: 1, zone: 'body' });
  });

  it('parses hOCR filtering low-confidence library stamps while preserving high-confidence imprint text', () => {
    const hocr = `
<div class='ocr_page' id='page_1'>
  <p class='ocr_par' id='par_1_2'><span class='ocr_line' id='line_1_2'><span class='ocrx_word' id='w_1' title='bbox 10 10 50 30; x_wconf 15'>J777</span></span></p>
  <p class='ocr_par' id='par_1_4'><span class='ocr_line' id='line_1_5'>
    <span class='ocrx_word' id='w_2' title='bbox 114 777 226 796; x_wconf 90'>BUENOS</span>
    <span class='ocrx_word' id='w_3' title='bbox 240 778 506 797; x_wconf 83'>AIRES—IMPRENTA</span>
    <span class='ocrx_word' id='w_4' title='bbox 522 778 558 796; x_wconf 89'>DE</span>
    <span class='ocrx_word' id='w_5' title='bbox 575 767 688 797; x_wconf 93'>MARTIN</span>
    <span class='ocrx_word' id='w_6' title='bbox 704 778 823 801; x_wconf 82'>BIEDMA</span>
  </span></p>
  <p class='ocr_par' id='par_1_5'>
    <span class='ocr_line' id='line_1_6'><span class='ocrx_word' id='w_7' title='bbox 331 860 563 920; x_wconf 25'>ABRARP</span></span>
    <span class='ocr_line' id='line_1_7'><span class='ocrx_word' id='w_8' title='bbox 357 935 415 972; x_wconf 77'>OCT</span><span class='ocrx_word' id='w_9' title='bbox 430 933 550 973; x_wconf 82'>161968</span></span>
  </p>
</div>`;
    const blocks = parseHocrToBlocks(hocr);
    expect(blocks.map((b) => b.text)).toEqual(['BUENOS AIRES—IMPRENTA DE MARTIN BIEDMA']);
  });

  it('does NOT trigger destructive re-OCR on legible prose pages with minor legacy typos', () => {
    const doc: BookReadingDocument = {
      bookId: '57',
      pdfPages: 12,
      ocrPending: false,
      chunks: [
        chunk({
          id: 'p0010.0000',
          type: 'para',
          page: 10,
          text: 'Al ofrecer al público esta décima quinta edición, uno de mis cHeataa casi imposible alcanzarle.',
        }),
      ],
    };
    expect(detectPagesNeedingSurgicalOcr(doc)).toEqual([]);
  });
});
