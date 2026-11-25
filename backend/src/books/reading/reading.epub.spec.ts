import { describe, expect, it } from 'vitest';
import {
  EPUB_ANALYSIS_OPF_MINIMAL,
  EPUB_METADATA_OPF_SCHEME,
  EPUB_METADATA_OPF_URN,
  READABLE_XHTML_FIXTURE,
  buildAnalysisOpf,
  buildEpubBuffer,
} from '../pdf-firewall/epub-firewall.fixtures.js';
import { extractReadingFromEpub } from './reading.epub.js';
import { ILLEGIBLE_READING_MESSAGE } from './reading.legibility.js';
import type { ReadingChunk } from './reading.types.js';

const CHARS_PER_PAGE = 1800;

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Fixture</title></head>
<body>
${body}
</body>
</html>`;
}

/** A word-repeated string whose trimmed length is exactly `length` characters. */
function exactProse(length: number): string {
  const unit = 'abc ';
  const times = Math.floor(length / unit.length);
  const head = unit.repeat(times).trimEnd();
  const tail = 'd'.repeat(length - head.length);
  return `${head}${tail}`;
}

function summarize(chunks: readonly ReadingChunk[]): Array<[string, number | undefined]> {
  return chunks.map((chunk) => [chunk.type, chunk.level]);
}

describe('reading.epub heading mapping', () => {
  it('maps h1/h2 to level 1, h3 to level 2 and h4-h6 to level 3', async () => {
    const buffer = await buildEpubBuffer({
      xhtml: xhtml(`
        <h1>Primer capitulo</h1>
        <h2>Segundo nivel</h2>
        <h3>Tercer nivel</h3>
        <h4>Cuarto nivel</h4>
        <h5>Quinto nivel</h5>
        <h6>Sexto nivel</h6>`),
    });
    const { document } = await extractReadingFromEpub(1, buffer);

    const headings = document.chunks.filter((chunk) => chunk.type === 'heading');
    expect(headings.map((chunk) => chunk.level)).toEqual([1, 1, 2, 3, 3, 3]);
    expect(headings.map((chunk) => chunk.text)).toEqual([
      'Primer capitulo',
      'Segundo nivel',
      'Tercer nivel',
      'Cuarto nivel',
      'Quinto nivel',
      'Sexto nivel',
    ]);
  });
});

describe('reading.epub paragraph runs', () => {
  it('keeps bold, italic and code marks as inline runs of one paragraph', async () => {
    const buffer = await buildEpubBuffer({
      xhtml: xhtml(
        '<p>Un <strong>texto</strong> con <em>énfasis</em> y <code>codigo()</code> final.</p>',
      ),
    });
    const { document } = await extractReadingFromEpub(1, buffer);

    const para = document.chunks.find((chunk) => chunk.type === 'para');
    expect(para?.text).toBe('Un texto con énfasis y codigo() final.');
    expect(para?.runs).toEqual([
      { text: 'Un ' },
      { text: 'texto ', marks: ['b'] },
      { text: 'con ' },
      { text: 'énfasis ', marks: ['i'] },
      { text: 'y ' },
      { text: 'codigo() ', marks: ['code'] },
      { text: 'final.' },
    ]);
  });

  it('degrades nested inline markup to text and drops empty paragraphs', async () => {
    const buffer = await buildEpubBuffer({
      xhtml: xhtml(`
        <p>Primero <span>con <b>negrita</b> anidada</span>.</p>
        <p>   </p>
        <p></p>`),
    });
    const { document } = await extractReadingFromEpub(1, buffer);

    const paras = document.chunks.filter((chunk) => chunk.type === 'para');
    expect(paras).toHaveLength(1);
    expect(paras[0].text).toBe('Primero con negrita anidada.');
    expect(paras[0].runs).toEqual([
      { text: 'Primero con ' },
      { text: 'negrita ', marks: ['b'] },
      { text: 'anidada.' },
    ]);
  });
});

describe('reading.epub spine walk', () => {
  it('walks the spine in order: nav toc first, then content', async () => {
    const buffer = await buildEpubBuffer({ xhtml: READABLE_XHTML_FIXTURE });
    const { document } = await extractReadingFromEpub(1, buffer);

    expect(summarize(document.chunks)).toEqual([
      ['toc', undefined],
      ['heading', 1],
      ['para', undefined],
      ['quote', undefined],
      ['list', undefined],
      ['code', undefined],
    ]);
    expect(document.chunks[0].text).toBe('Capitulo 1\tcontent.xhtml');
  });

  it('maps quote, code and list blocks to their chunk shapes', async () => {
    const buffer = await buildEpubBuffer({ xhtml: READABLE_XHTML_FIXTURE });
    const { document } = await extractReadingFromEpub(1, buffer);

    const quote = document.chunks.find((chunk) => chunk.type === 'quote');
    expect(quote?.text).toBe('"La libertad, Sancho, es uno de los mas preciosos dones."');

    const list = document.chunks.find((chunk) => chunk.type === 'list');
    expect(list?.ordered).toBe(false);
    expect(list?.items).toEqual(['Rocinante', 'Dulcinea']);
    expect(list?.text).toBe('Rocinante\nDulcinea');

    const code = document.chunks.find((chunk) => chunk.type === 'code');
    expect(code?.text).toBe('if (libro.aprobado) { publicar(libro); }');
  });

  it('marks ordered lists and keeps figcaptions as caption chunks', async () => {
    const buffer = await buildEpubBuffer({
      xhtml: xhtml(`
        <ol>
          <li>Primero</li>
          <li>Segundo</li>
        </ol>
        <figure><img src="mapa.png" alt="mapa"/><figcaption>Mapa del territorio.</figcaption></figure>`),
    });
    const { document } = await extractReadingFromEpub(1, buffer);

    const list = document.chunks.find((chunk) => chunk.type === 'list');
    expect(list?.ordered).toBe(true);
    expect(list?.items).toEqual(['Primero', 'Segundo']);

    const caption = document.chunks.find((chunk) => chunk.type === 'caption');
    expect(caption?.text).toBe('Mapa del territorio.');
  });

  it('skips header, footer and footnote asides', async () => {
    const buffer = await buildEpubBuffer({
      xhtml: xhtml(`
        <header><p>Coleccion Vigilia</p></header>
        <p>Texto del capitulo.</p>
        <aside epub:type="footnote"><p>1. Nota al pie.</p></aside>
        <footer><p>Copyright 2026</p></footer>`),
    });
    const { document } = await extractReadingFromEpub(1, buffer);

    expect(document.chunks.map((chunk) => chunk.text)).toContain('Texto del capitulo.');
    expect(document.chunks.map((chunk) => chunk.text)).not.toContain('Coleccion Vigilia');
    expect(document.chunks.map((chunk) => chunk.text)).not.toContain('1. Nota al pie.');
    expect(document.chunks.map((chunk) => chunk.text)).not.toContain('Copyright 2026');
  });

  it('resolves itemref hrefs relative to the OPF directory', async () => {
    const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Subdir</dc:title></metadata>
  <manifest>
    <item id="c1" href="../OEBPS/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`;
    const buffer = await buildEpubBuffer({
      opfPath: 'OEBPS/content.opf',
      opf,
      extraEntries: [
        { path: 'OEBPS/ch1.xhtml', data: xhtml('<p>Primero del paquete.</p>') },
        { path: 'OEBPS/ch2.xhtml', data: xhtml('<p>Segundo del paquete.</p>') },
      ],
    });
    const { document, metadata } = await extractReadingFromEpub(1, buffer);

    expect(document.chunks.map((chunk) => chunk.text)).toEqual([
      'Primero del paquete.',
      'Segundo del paquete.',
    ]);
    expect(metadata?.title).toBe('Subdir');
  });
});

describe('reading.epub table of contents', () => {
  it('reads toc entries from the nav document', async () => {
    const buffer = await buildEpubBuffer({
      navExtra: '<li><a href="content.xhtml#s2">Capitulo 2</a></li>',
      xhtml: READABLE_XHTML_FIXTURE,
    });
    const { document } = await extractReadingFromEpub(1, buffer);

    const toc = document.chunks.filter((chunk) => chunk.type === 'toc');
    expect(toc).toHaveLength(1);
    expect(toc[0].text).toBe('Capitulo 1\tcontent.xhtml\nCapitulo 2\tcontent.xhtml#s2');
  });

  it('falls back to toc.ncx when no nav toc exists', async () => {
    const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>NCX</dc:title></metadata>
  <manifest>
    <item id="c1" href="content.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="c1"/></spine>
</package>`;
    const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1" playOrder="1">
      <navLabel><text>Prologo</text></navLabel>
      <content src="content.xhtml"/>
    </navPoint>
    <navPoint id="n2" playOrder="2">
      <navLabel><text>Capitulo 1</text></navLabel>
      <content src="content.xhtml#c1"/>
    </navPoint>
  </navMap>
</ncx>`;
    const buffer = await buildEpubBuffer({
      opf,
      extraEntries: [{ path: 'toc.ncx', data: ncx }],
      xhtml: READABLE_XHTML_FIXTURE,
    });
    const { document } = await extractReadingFromEpub(1, buffer);

    const toc = document.chunks.filter((chunk) => chunk.type === 'toc');
    expect(toc).toHaveLength(1);
    expect(toc[0].text).toBe('Prologo\tcontent.xhtml\nCapitulo 1\tcontent.xhtml#c1');
    expect(document.chunks[0].type).toBe('toc');
  });
});

describe('reading.epub synthetic pagination', () => {
  it('numbers pages with the running character budget', async () => {
    const first = exactProse(CHARS_PER_PAGE);
    const second = exactProse(CHARS_PER_PAGE);
    const buffer = await buildEpubBuffer({
      xhtml: xhtml(`
        <p>${first}</p>
        <p>Corto remate del capitulo.</p>
        <p>${second}</p>
        <p>Fin.</p>`),
    });
    const { document } = await extractReadingFromEpub(1, buffer);

    const paras = document.chunks.filter((chunk) => chunk.type === 'para');
    expect(paras.map((chunk) => chunk.text.length)).toEqual([CHARS_PER_PAGE, 26, CHARS_PER_PAGE, 4]);
    expect(paras.map((chunk) => chunk.page)).toEqual([1, 2, 2, 3]);

    const totalChars = paras.reduce((sum, chunk) => sum + chunk.text.length, 0);
    expect(document.pdfPages).toBe(Math.ceil(totalChars / CHARS_PER_PAGE));
    expect(document.pdfPages).toBe(3);
  });

  it('never goes below one page for short documents', async () => {
    const buffer = await buildEpubBuffer({ xhtml: xhtml('<p>Un parrafo breve.</p>') });
    const { document } = await extractReadingFromEpub(1, buffer);

    expect(document.pdfPages).toBe(1);
    expect(document.chunks[0].page).toBe(1);
  });
});

describe('reading.epub metadata', () => {
  it('extracts title, aut creator, publisher, urn:isbn and description', async () => {
    const buffer = await buildEpubBuffer({ opf: EPUB_METADATA_OPF_URN });
    const { metadata } = await extractReadingFromEpub(1, buffer);

    expect(metadata).toEqual({
      title: 'Manual de prueba',
      author: 'Autora Principal',
      publisher: 'Editorial Prueba',
      isbn: '9783161484100',
      description: 'Un clásico intemporal & breve.',
    });
  });

  it('extracts an ISBN declared with opf:scheme', async () => {
    const buffer = await buildEpubBuffer({ opf: EPUB_METADATA_OPF_SCHEME });
    const { metadata } = await extractReadingFromEpub(1, buffer);

    expect(metadata).toEqual({
      title: 'Otro manual',
      author: 'Autora Única',
      publisher: 'Otra Editorial',
      isbn: '0306406152',
      description: 'Descripción simple.',
    });
  });

  it('normalizes URL-encoded ISBN identifiers', async () => {
    const buffer = await buildEpubBuffer({
      opf: buildAnalysisOpf(
        '    <dc:identifier opf:scheme="ISBN">urn:isbn%3A9780306406157</dc:identifier>',
      ),
    });
    const { metadata } = await extractReadingFromEpub(1, buffer);

    expect(metadata?.isbn).toBe('9780306406157');
    expect(metadata?.title).toBeNull();
    expect(metadata?.author).toBeNull();
  });

  it('leaves absent metadata fields null', async () => {
    const buffer = await buildEpubBuffer({ opf: EPUB_ANALYSIS_OPF_MINIMAL });
    const { metadata } = await extractReadingFromEpub(1, buffer);

    expect(metadata).toEqual({
      title: 'Libro de prueba',
      author: 'Autora Prueba',
      publisher: null,
      isbn: null,
      description: null,
    });
  });
});

describe('reading.epub legibility gate', () => {
  it('throws on mojibake bodies', async () => {
    const buffer = await buildEpubBuffer({
      xhtml: xhtml(`<p>${'"#$%&\' $(!")*! '.repeat(12)}</p>`),
    });

    await expect(extractReadingFromEpub(1, buffer)).rejects.toThrow(ILLEGIBLE_READING_MESSAGE);
    await expect(extractReadingFromEpub(1, buffer)).rejects.toBeInstanceOf(Error);
  });

  it('returns empty documents without throwing', async () => {
    const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Vacio</dc:title></metadata>
  <manifest><item id="c1" href="content.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;
    const buffer = await buildEpubBuffer({ opf, xhtml: xhtml('  <p></p>  ') });
    const { document } = await extractReadingFromEpub(7, buffer);

    expect(document.chunks).toEqual([]);
    expect(document.ocrPending).toBe(true);
    expect(document.pdfPages).toBe(1);
    expect(document.bookId).toBe('7');
  });
});
