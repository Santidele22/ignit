import { describe, expect, it } from 'vitest';
import {
  READING_EXTRACTOR_VERSION,
  classifyChunkType,
  classifyMoodAndCues,
  cleanPageTextsForExtraction,
  extractPagesFromPdfBuffer,
  extractReadingFromPdftohtmlXml,
  splitPageIntoParagraphs,
} from './book-reading.extractor.js';

describe('book-reading.extractor', () => {
  it('classifies moods and extracts matching cues from passage text', () => {
    const espera = classifyMoodAndCues(
      'Drogo contemplaba desde el muro la llanura en silencio, porque la espera era su oficio.',
      0,
    );
    expect(espera.mood).toBe('espera');
    expect(espera.cues).toEqual(expect.arrayContaining(['contemplaba', 'muro', 'llanura']));

    const alerta = classifyMoodAndCues(
      'En las noches más oscuras los centinelas oían algo moverse en la sombra.',
      1,
    );
    expect(alerta.mood).toBe('alerta');
    expect(alerta.cues).toEqual(expect.arrayContaining(['noches', 'centinelas', 'moverse']));

    const polvo = classifyMoodAndCues(
      'Los años pasaban como el polvo sobre las almenas de piedra y bronce.',
      2,
    );
    expect(polvo.mood).toBe('polvo');
    expect(polvo.cues).toEqual(expect.arrayContaining(['años', 'polvo', 'almenas']));

    const niebla = classifyMoodAndCues(
      'En marzo llegarían los relevos bajo la lluvia y la niebla de un país lejano.',
      3,
    );
    expect(niebla.mood).toBe('niebla');
    expect(niebla.cues).toEqual(expect.arrayContaining(['marzo', 'relevos', 'lluvia']));
  });

  it('extracts pages from a raw PDF buffer with BT/ET text operators', () => {
    const raw = Buffer.from(
      [
        '%PDF-1.4',
        '1 0 obj << /Type /Page >> endobj',
        '2 0 obj << /Length 64 >> stream',
        'BT /F1 12 Tf 72 720 Td (El desierto de los tartaros) Tj ET',
        'endstream endobj',
        '%%EOF',
      ].join('\n'),
    );
    const parsed = extractPagesFromPdfBuffer(raw);
    expect(parsed.pageCount).toBe(1);
    expect(parsed.pages).toEqual(['El desierto de los tartaros']);
  });

  it('preserves line breaks and classifies table-of-contents blocks as toc', () => {
    const pageText = [
      'Índice',
      'Nota de la traducción . . . . . . . . . . . . . . . . 1',
      'Presentación . . . . . . . . . . . . . . . . . . . . . 1',
      'La programación como construcción de teorías . . . . . 2',
      'Conclusiones . . . . . . . . . . . . . . . . . . . . . 13',
    ].join('\n');

    const blocks = splitPageIntoParagraphs(pageText);
    expect(blocks.length).toBe(2);
    expect(blocks[0].text).toBe('Índice');
    expect(classifyChunkType(blocks[0].text, 0)).toBe('heading');
    expect(blocks[1].text).toContain('\n');
    expect(classifyChunkType(blocks[1].text, 1)).toBe('toc');
  });

  it('does not classify mid-sentence page continuations as headings', () => {
    expect(classifyChunkType('Ivánovich en voz alta—. Qué pena.', 0)).toBe('para');
    expect(classifyChunkType('y siguió caminando hacia la puerta.', 0)).toBe('para');
    expect(classifyChunkType('Capítulo II', 0)).toBe('heading');
  });

  it('strips ebook site promos, ePub ripper stamps, and repeated page headers/footers during extraction', () => {
    const rawPages = [
      [
        'Libro proporcionado por el equipo Le Libros Visite nuestro sitio y descarga esto y otros miles de libros',
        'http://LeLibros.org/',
        '',
        'Las intermitencias de la muerte ePub r1.4',
        'Andaluso 08.02.18',
        '',
        'ebookelo.com - Página 1',
      ].join('\n'),
      [
        'Capítulo I',
        '',
        'Al día siguiente no murió nadie.',
        'www.lectulandia.com - Página 2',
      ].join('\n'),
      [
        'La muerte había suspendido su oficio.',
        'www.lectulandia.com - Página 3',
      ].join('\n'),
      [
        'El país entero quedó en suspenso.',
        'www.lectulandia.com - Página 4',
      ].join('\n'),
    ];

    const cleanedPages = cleanPageTextsForExtraction(rawPages);
    expect(splitPageIntoParagraphs(cleanedPages[0], { pageNum: 1, totalPages: 4 })).toEqual([]);
    expect(
      splitPageIntoParagraphs(cleanedPages[1], { pageNum: 2, totalPages: 4 }).map((b) => b.text),
    ).toEqual(['Capítulo I', 'Al día siguiente no murió nadie.']);
    expect(
      splitPageIntoParagraphs(cleanedPages[2], { pageNum: 3, totalPages: 4 }).map((b) => b.text),
    ).toEqual(['La muerte había suspendido su oficio.']);
  });

  it('extracts hierarchical headings, leaderless TOC, inline runs, lists, quotes, captions, dedications, meta, de-hyphenation, and cross-page paragraphs from pdftohtml XML', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<pdf2xml producer="poppler" version="26.08.0">
<page number="1" position="absolute" top="0" left="0" height="1041" width="828">
  <fontspec id="0" size="33" family="Bookman-Demi" color="#231f20"/>
  <fontspec id="1" size="18" family="Helvetica" color="#231f20"/>
  <fontspec id="2" size="14" family="Times" color="#231f20"/>
  <fontspec id="3" size="15" family="Times" color="#231f20"/>
  <fontspec id="4" size="15" family="Times-Bold" color="#231f20"/>
  <fontspec id="5" size="15" family="Times-Italic" color="#231f20"/>
  <fontspec id="6" size="12" family="MCPdigital" color="#231f20"/>
  <fontspec id="7" size="12" family="Helvetica" color="#231f20"/>
  <text top="138" left="431" width="224" height="31" font="0"><b>SISTEMAS OPERATIVOS</b></text>
  <text top="137" left="429" width="224" height="31" font="0"><b>SISTEMAS OPERATIVOS</b></text>
  <text top="452" left="1008" width="0" height="51" font="0"><b>SISTEMAS</b></text>
  <text top="280" left="321" width="166" height="17" font="1">TERCERA EDICIÓN</text>
  <text top="374" left="266" width="276" height="20" font="2"><b>ANDREW S. TANENBAUM</b></text>
  <text top="401" left="342" width="126" height="16" font="5"><i>Vrije Universiteit</i></text>
  <text top="486" left="360" width="88" height="12" font="2">TRADUCCIÓN</text>
  <text top="506" left="303" width="203" height="14" font="2"><b>Alfonso Vidal Romero Elizondo</b></text>
  <text top="600" left="350" width="90" height="14" font="2">09 10 11 12</text>
</page>
<page number="2" position="absolute" top="0" left="0" height="1041" width="828">
  <text top="210" left="240" width="320" height="18" font="5"><i>Para Suzanne, Barbara, Marvin y a la</i></text>
  <text top="232" left="260" width="280" height="18" font="5"><i>memoria de Bram y Sweetie</i></text>
</page>
<page number="3" position="absolute" top="0" left="0" height="1041" width="828">
  <text top="94" left="127" width="20" height="14" font="2"><b>viii</b></text>
  <text top="96" left="648" width="74" height="11" font="7"><b>CONTENIDO</b></text>
  <text top="150" left="173" width="160" height="24" font="0"><b>CONTENIDO</b></text>
  <text top="214" left="110" width="15" height="25" font="0"><b>1</b></text>
  <text top="218" left="152" width="180" height="19" font="1"><b>INTRODUCCIÓN</b></text>
  <text top="218" left="678" width="15" height="19" font="1"><b>1</b></text>
  <text top="266" left="152" width="19" height="14" font="2">1.1</text>
  <text top="266" left="197" width="220" height="14" font="2">¿QUÉ ES UN SISTEMA OPERATIVO?</text>
  <text top="266" left="450" width="15" height="14" font="2">3</text>
  <text top="285" left="197" width="310" height="14" font="2">1.1.1 El sistema operativo como una máquina extendida</text>
  <text top="285" left="530" width="15" height="14" font="2">4</text>
  <text top="304" left="197" width="310" height="14" font="2">1.1.2 El sistema operativo como administrador de recursos</text>
  <text top="304" left="530" width="15" height="14" font="2">6</text>
</page>
<page number="4" position="absolute" top="0" left="0" height="1041" width="828">
  <text top="165" left="384" width="40" height="67" font="0"><b>1</b></text>
  <text top="300" left="276" width="256" height="31" font="0"><b>INTRODUCCIÓN</b></text>
  <text top="420" left="107" width="350" height="19" font="1"><b>1.1 ¿QUÉ ES UN SISTEMA OPERATIVO?</b></text>
  <text top="460" left="107" width="410" height="16" font="1"><b>1.1.1 El sistema operativo como máquina extendida</b></text>
  <text top="500" left="134" width="568" height="14" font="3">Las computadoras tienen dos modos: </text>
  <text top="500" left="350" width="100" height="14" font="4"><b>modo kernel</b></text>
  <text top="500" left="455" width="120" height="14" font="3"> y </text>
  <text top="502" left="470" width="32" height="11" font="6">read</text>
  <text top="500" left="505" width="190" height="14" font="3"> para en-</text>
  <text top="519" left="107" width="595" height="14" font="3">trada/salida en sistemas moder-</text>
  <text top="538" left="107" width="595" height="14" font="3">nos, incluyendo soporte de </text>
  <text top="538" left="310" width="120" height="14" font="5"><i>device drivers</i></text>
  <text top="538" left="432" width="140" height="14" font="3"> que tienen acceso</text>
  <text top="960" left="402" width="8" height="14" font="2"><b>1</b></text>
</page>
<page number="5" position="absolute" top="0" left="0" height="1041" width="828">
  <text top="94" left="107" width="87" height="14" font="2">SECCIÓN 1.1</text>
  <text top="94" left="281" width="246" height="14" font="2">¿QUÉ ES UN SISTEMA OPERATIVO?</text>
  <text top="94" left="694" width="8" height="14" font="2"><b>2</b></text>
  <text top="127" left="107" width="595" height="14" font="3">completo a todo el hardware disponible.</text>
  <text top="165" left="107" width="180" height="14" font="4"><b>LO NUEVO DE ESTA EDICIÓN:</b></text>
  <text top="188" left="125" width="7" height="14" font="3">•</text>
  <text top="188" left="150" width="420" height="14" font="3">Cobertura sobre Linux/Unix y disposi-</text>
  <text top="207" left="150" width="120" height="14" font="3">tivos móviles.</text>
  <text top="230" left="125" width="7" height="14" font="3">•</text>
  <text top="230" left="150" width="380" height="14" font="3">Análisis actualizado sobre seguridad.</text>
  <text top="280" left="344" width="60" height="11" font="7">Hardware</text>
  <text top="300" left="420" width="60" height="11" font="7">Software</text>
  <text top="320" left="220" width="70" height="11" font="7">Modo kernel</text>
  <text top="350" left="314" width="240" height="12" font="2"><b>Figura 1-1.</b> Ubicación del sistema operativo.</text>
  <text top="410" left="220" width="420" height="14" font="5"><i>La simplicidad consiste en restar lo obvio y añadir lo significativo.</i></text>
  <text top="432" left="220" width="180" height="14" font="3">— John Maeda</text>
</page>
</pdf2xml>`;

    const doc = extractReadingFromPdftohtmlXml(42, xml);
    expect(doc.extractorVersion).toBe(READING_EXTRACTOR_VERSION);
    expect(doc.pdfPages).toBe(5);
    expect(doc.ocrPending).toBe(false);

    // No shadow duplication, no zero-width spine text, no running header/footer noise
    const allTexts = doc.chunks.map((c) => c.text);
    expect(allTexts.filter((t) => t === 'SISTEMAS OPERATIVOS').length).toBe(1);
    expect(allTexts.some((t) => t === 'SISTEMAS')).toBe(false);
    expect(allTexts.some((t) => t.includes('SECCIÓN 1.1'))).toBe(false);
    expect(allTexts.some((t) => t === 'viii')).toBe(false);

    // Frontmatter metadata & dedication
    expect(doc.chunks.some((c) => c.type === 'meta' && c.text.includes('TERCERA EDICIÓN'))).toBe(true);
    expect(doc.chunks.some((c) => c.type === 'meta' && c.text.includes('09 10 11 12'))).toBe(true);
    expect(doc.chunks.some((c) => c.type === 'dedication' && c.text.includes('Para Suzanne'))).toBe(true);

    // Leaderless TOC extracted cleanly as heading + toc (with tab-separated page numbers)
    const tocChunk = doc.chunks.find((c) => c.type === 'toc');
    expect(tocChunk).toBeDefined();
    expect(tocChunk?.text).toContain('1 INTRODUCCIÓN\t1');
    expect(tocChunk?.text).toContain('1.1 ¿QUÉ ES UN SISTEMA OPERATIVO?\t3');
    expect(tocChunk?.text).toContain('1.1.1 El sistema operativo como una máquina extendida\t4');

    // Heading hierarchy levels
    const h1 = doc.chunks.find((c) => c.type === 'heading' && c.text.includes('INTRODUCCIÓN'));
    const h2 = doc.chunks.find((c) => c.type === 'heading' && c.text.startsWith('1.1 '));
    const h3 = doc.chunks.find((c) => c.type === 'heading' && c.text.startsWith('1.1.1 '));
    expect(h1?.level).toBe(1);
    expect(h2?.level).toBe(2);
    expect(h3?.level).toBe(3);

    // Cross-page paragraph merged + de-hyphenated + inline runs preserved
    const mergedPara = doc.chunks.find(
      (c) => c.type === 'para' && c.text.includes('Las computadoras tienen dos modos'),
    );
    expect(mergedPara).toBeDefined();
    expect(mergedPara?.text).toContain('entrada/salida');
    expect(mergedPara?.text).toContain('modernos');
    expect(mergedPara?.text).toContain('tienen acceso completo a todo el hardware disponible.');
    expect(mergedPara?.runs?.map((r) => r.text).join('')).toBe(mergedPara?.text);
    expect(mergedPara?.runs?.some((r) => r.marks?.includes('b') && r.text.includes('modo kernel'))).toBe(true);
    expect(mergedPara?.runs?.some((r) => r.marks?.includes('code') && r.text === 'read')).toBe(true);
    expect(mergedPara?.runs?.some((r) => r.marks?.includes('i') && r.text.includes('device drivers'))).toBe(true);

    // List chunk with wrapped de-hyphenated items
    const listChunk = doc.chunks.find((c) => c.type === 'list');
    expect(listChunk).toBeDefined();
    expect(listChunk?.ordered).toBe(false);
    expect(listChunk?.items).toEqual([
      'Cobertura sobre Linux/Unix y dispositivos móviles.',
      'Análisis actualizado sobre seguridad.',
    ]);

    // Diagram labels suppressed, caption kept as caption
    expect(allTexts.some((t) => t === 'Hardware')).toBe(false);
    expect(doc.chunks.some((c) => c.type === 'caption' && c.text.startsWith('Figura 1-1.'))).toBe(true);

    // Indented italic quote / epigraph kept as quote
    const quoteChunk = doc.chunks.find((c) => c.type === 'quote');
    expect(quoteChunk).toBeDefined();
    expect(quoteChunk?.text).toContain('La simplicidad consiste');
  });

  it('handles 1.11x headings, centered Roman chapters, uppercase subheadings, and hyphenated hanging indents without false quotes', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<pdf2xml producer="poppler" version="26.08.0">
<page number="1" position="absolute" top="0" left="0" height="1263" width="892">
  <fontspec id="12" size="24" family="TimesNewRoman" color="#000000"/>
  <fontspec id="13" size="21" family="TimesNewRoman" color="#000000"/>
  <text top="242" left="384" width="131" height="22" font="12">Justificación</text>
  <text top="471" left="173" width="590" height="19" font="13">1a Fue un movimiento individualista que terminó en la ma-</text>
  <text top="495" left="192" width="95" height="19" font="13">sificación.</text>
  <text top="519" left="171" width="543" height="19" font="13">2a Fue un movimiento naturalista que terminó en la máquina.</text>
  <text top="543" left="128" width="642" height="19" font="13">Esta paradoja es el resultado de dos fuerzas dinámicas que dominan la era moderna.</text>
</page>
<page number="2" position="absolute" top="0" left="0" height="1263" width="892">
  <text top="229" left="443" width="13" height="22" font="12">I</text>
  <text top="300" left="252" width="388" height="22" font="12">LA ESENCIA DEL RENACIMIENTO</text>
  <text top="490" left="128" width="363" height="19" font="13">EL DESPERTAR DEL HOMBRE LAICO</text>
  <text top="514" left="171" width="599" height="19" font="13">Cuando por primera vez estudié la historia mundial encontré curiosas paradojas.</text>
  <text top="538" left="128" width="642" height="19" font="13">El pensamiento medieval dejó paso lentamente a una nueva comprensión del universo.</text>
</page>
</pdf2xml>`;

    const doc = extractReadingFromPdftohtmlXml(77, xml);
    expect(
      doc.chunks.find((c) => c.type === 'heading' && c.text === 'Justificación')?.level,
    ).toBe(1);
    expect(
      doc.chunks.find((c) => c.type === 'heading' && c.text === 'I · LA ESENCIA DEL RENACIMIENTO')
        ?.level,
    ).toBe(1);
    expect(
      doc.chunks.some(
        (c) => c.type === 'heading' && c.text === 'EL DESPERTAR DEL HOMBRE LAICO',
      ),
    ).toBe(true);
    expect(doc.chunks.some((c) => c.type === 'quote')).toBe(false);
    expect(
      doc.chunks.some(
        (c) =>
          c.type === 'para' &&
          c.text === '1a Fue un movimiento individualista que terminó en la masificación.',
      ),
    ).toBe(true);
  });

  it('detects C/multi-line code blocks in non-monospace fonts, preserves line breaks, blank lines, and relative indentation', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<pdf2xml producer="poppler" version="26.08.0">
<page number="1" position="absolute" top="0" left="0" height="1200" width="828">
  <fontspec id="0" size="13" family="Times-Roman" color="#000000"/>
  <fontspec id="1" size="12" family="Helvetica" color="#000000"/>
  <fontspec id="2" size="11" family="Times-Roman" color="#000000"/>
  <text top="100" left="107" width="580" height="16" font="0">El siguiente programa ilustra la solución al problema del productor-consumidor usando semáforos.</text>
  <text top="145" left="118" width="420" height="14" font="1">#define N 100 /* número de ranuras en el búfer */</text>
  <text top="163" left="118" width="460" height="14" font="1">typedef int semaforo; /* los semáforos son un tipo especial de int */</text>
  <text top="181" left="118" width="260" height="14" font="1">semaforo mutex = 1; /* controla</text>
  <text top="199" left="298" width="260" height="14" font="1">el acceso a la región crítica */</text>
  <text top="217" left="118" width="380" height="14" font="1">semaforo vacias = N; /* cuenta las ranuras vacías del búfer */</text>
  <text top="248" left="118" width="140" height="14" font="1">void productor(void)</text>
  <text top="266" left="118" width="12" height="14" font="1">{</text>
  <text top="284" left="146" width="110" height="14" font="1">int elemento;</text>
  <text top="314" left="146" width="240" height="14" font="1">while(TRUE){ /* TRUE es la constante 1 */</text>
  <text top="332" left="174" width="260" height="14" font="1">elemento = producir_elemento();</text>
  <text top="350" left="174" width="240" height="14" font="1">down(&amp;vacias); /* disminuye la</text>
  <text top="368" left="298" width="220" height="14" font="1">cuenta de ranuras vacías */</text>
  <text top="386" left="174" width="160" height="14" font="1">down(&amp;mutex);</text>
  <text top="404" left="146" width="12" height="14" font="1">}</text>
  <text top="422" left="118" width="12" height="14" font="1">}</text>
  <text top="460" left="107" width="320" height="13" font="2"><b>Figura 2-28.</b> El problema productor-consumidor.</text>
  <text top="495" left="107" width="580" height="16" font="0">En la figura anterior cada proceso llama a down antes de entrar en su región crítica.</text>
</page>
</pdf2xml>`;

    const doc = extractReadingFromPdftohtmlXml(88, xml);
    expect(doc.extractorVersion).toBeGreaterThanOrEqual(3);

    const codeChunks = doc.chunks.filter((c) => c.type === 'code');
    expect(codeChunks).toHaveLength(1);
    const code = codeChunks[0].text;
    const lines = code.split('\n');

    expect(lines[0]).toBe('#define N 100 /* número de ranuras en el búfer */');
    expect(lines).toContain('typedef int semaforo; /* los semáforos son un tipo especial de int */');
    expect(lines).toContain('void productor(void)');
    expect(lines.some((l) => /^\s+int elemento;$/.test(l))).toBe(true);
    expect(lines.some((l) => /^\s+while\(TRUE\)\{/.test(l))).toBe(true);
    expect(lines.some((l) => /^\s{4,}elemento = producir_elemento\(\);$/.test(l))).toBe(true);
    expect(code).toContain('void productor(void)\n{');
    expect(doc.chunks.some((c) => c.type === 'caption' && c.text.startsWith('Figura 2-28.'))).toBe(true);
    expect(
      doc.chunks.some((c) => c.type === 'para' && c.text.includes('En la figura anterior')),
    ).toBe(true);
  });

  it('detects monospace code with TeX/Linux font names and preserves code blocks in pdftotext fallback', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<pdf2xml producer="poppler" version="26.08.0">
<page number="1" position="absolute" top="0" left="0" height="900" width="828">
  <fontspec id="0" size="13" family="Times-Roman" color="#000000"/>
  <fontspec id="1" size="12" family="CMTT10" color="#000000"/>
  <text top="100" left="107" width="420" height="15" font="0">Ejemplo con una línea bastante larga de comentario y función:</text>
  <text top="135" left="120" width="600" height="14" font="1">const result = await fetchSomethingFromLongEndpointNameWithDescriptiveComment({ timeoutMs: 5000 });</text>
  <text top="154" left="120" width="200" height="14" font="1">return result.ok;</text>
</page>
</pdf2xml>`;

    const doc = extractReadingFromPdftohtmlXml(89, xml);
    const codeChunk = doc.chunks.find((c) => c.type === 'code');
    expect(codeChunk).toBeDefined();
    expect(codeChunk?.text).toBe(
      'const result = await fetchSomethingFromLongEndpointNameWithDescriptiveComment({ timeoutMs: 5000 });\nreturn result.ok;',
    );

    const fallbackPage = [
      'Veamos el código de sincronización.',
      '',
      '#define N 100 /* tamaño */',
      'void productor(void) {',
      '    int elemento;',
      '    down(&mutex);',
      '}',
      '',
      'Luego la ejecución continúa normalmente en el hilo principal.',
    ].join('\n');

    const blocks = splitPageIntoParagraphs(fallbackPage);
    expect(blocks.length).toBe(3);
    expect(classifyChunkType(blocks[0].text, 0)).toBe('para');
    expect(classifyChunkType(blocks[1].text, 1)).toBe('code');
    expect(blocks[1].text).toContain('\n    int elemento;\n');
    expect(classifyChunkType(blocks[2].text, 2)).toBe('para');
  });

  it('drops InDesign pseudo-Latin placeholder text and layout slot markers while preserving real prose', () => {
    const page = [
      'E2 a E3',
      '',
      'Evel evelia porem nem et faccus sa enturias con none cumqui cones perovit lantiasped qui vendita tecaero',
      '',
      'Omnist expligenesti niendaes aliti corempo repture nes eque ariae simenis illatem poreriamene am con consers',
      '',
      'El arte de la guerra es de vital importancia para el Estado.',
    ].join('\n');

    const blocks = splitPageIntoParagraphs(page, { pageNum: 1, totalPages: 40 });
    expect(blocks.map((b) => b.text)).toEqual([
      'El arte de la guerra es de vital importancia para el Estado.',
    ]);
  });
});

