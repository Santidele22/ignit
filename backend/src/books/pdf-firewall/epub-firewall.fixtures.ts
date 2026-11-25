import JSZip from 'jszip';

/**
 * Shared in-memory EPUB fixtures for the firewall and extractor suites. Every
 * builder returns a deterministic ZIP buffer so tests never read the network
 * nor the filesystem for inputs.
 */

/** A small, clean spine document: headings, paragraphs, a quote and a list. */
export const READABLE_XHTML_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Capitulo 1</title></head>
<body>
  <h1>El origen de la aventura</h1>
  <p>En un lugar de <strong>La Mancha</strong>, de cuyo nombre no quiero acordarme, vivia un <em>hidalgo</em>.</p>
  <blockquote>"La libertad, Sancho, es uno de los mas preciosos dones."</blockquote>
  <ul>
    <li>Rocinante</li>
    <li>Dulcinea</li>
  </ul>
  <pre><code>if (libro.aprobado) { publicar(libro); }</code></pre>
</body>
</html>`;

/** Minimal but structurally valid OPF used when the test does not care about metadata. */
export const EPUB_ANALYSIS_OPF_MINIMAL = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:1234-5678</dc:identifier>
    <dc:title>Libro de prueba</dc:title>
    <dc:creator>Autora Prueba</dc:creator>
    <dc:language>es</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="content.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="nav"/>
    <itemref idref="c1"/>
  </spine>
</package>`;

const NAV_XHTML = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body><nav epub:type="toc"><ol><li><a href="content.xhtml">Capitulo 1</a></li></ol></nav></body>
</html>`;

/** `META-INF/container.xml` pointing at the OPF package document at `fullPath`. */
export function containerXmlFor(fullPath: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="${fullPath}" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
}

const CONTAINER_XML = containerXmlFor('content.opf');

/**
 * Builds an OPF package that keeps the analysis manifest/spine (nav + `content.xhtml`)
 * but swaps in the given `<metadata>` markup, so metadata cases never drift from the
 * documents the extractor walks.
 */
export function buildAnalysisOpf(metadataXml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${metadataXml}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="content.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="nav"/>
    <itemref idref="c1"/>
  </spine>
</package>`;
}

/** OPF metadata with an `urn:isbn:` identifier and an `opf:role="aut"` creator. */
export const EPUB_METADATA_OPF_URN = buildAnalysisOpf(`    <dc:identifier id="book-id">urn:uuid:1234-5678</dc:identifier>
    <dc:identifier>urn:isbn:978-3-16-148410-0</dc:identifier>
    <dc:title>Manual de prueba</dc:title>
    <dc:creator>Traductora Secundaria</dc:creator>
    <dc:creator opf:role="aut">Autora Principal</dc:creator>
    <dc:publisher>Editorial Prueba</dc:publisher>
    <dc:description>Un <b>clásico</b> intemporal &amp; breve.</dc:description>`);

/** OPF metadata whose ISBN comes from `opf:scheme="ISBN"` instead of `urn:isbn:`. */
export const EPUB_METADATA_OPF_SCHEME = buildAnalysisOpf(`    <dc:identifier opf:scheme="ISBN">0-306-40615-2</dc:identifier>
    <dc:title>Otro manual</dc:title>
    <dc:creator>Autora Única</dc:creator>
    <dc:publisher>Otra Editorial</dc:publisher>
    <dc:description>Descripción simple.</dc:description>`);

export type EpubFixtureOptions = {
  /** Spine document body (replaces `content.xhtml`). */
  xhtml?: string;
  /** OPF package document (replaces the minimal one). */
  opf?: string;
  /** ZIP path of the OPF package document (defaults to `content.opf`, mirrored in container.xml). */
  opfPath?: string;
  /** Extra raw entries to inject (path traversal payloads, DRM, junk). */
  extraEntries?: Array<{ path: string; data: string }>;
  /** Replaces `META-INF/encryption.xml` content; when set, DRM is present. */
  encryptionXml?: string;
  /** Extra markup appended inside `<body>` of the nav document. */
  navExtra?: string;
};

/** Builds the in-memory ZIP structure of the fixture EPUB (no bytes written). */
export async function buildEpub(options: EpubFixtureOptions = {}): Promise<JSZip> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  const opfPath = options.opfPath ?? 'content.opf';
  zip.file(
    'META-INF/container.xml',
    opfPath === 'content.opf' ? CONTAINER_XML : containerXmlFor(opfPath),
  );
  zip.file(opfPath, options.opf ?? EPUB_ANALYSIS_OPF_MINIMAL);
  zip.file(
    'nav.xhtml',
    NAV_XHTML.replace('</ol>', `${options.navExtra ?? ''}</ol>`),
  );
  zip.file('content.xhtml', options.xhtml ?? READABLE_XHTML_FIXTURE);
  if (options.encryptionXml) {
    zip.file('META-INF/encryption.xml', options.encryptionXml);
  }
  for (const entry of options.extraEntries ?? []) {
    zip.file(entry.path, entry.data);
  }
  return zip;
}

/** Serialized fixture EPUB. */
export async function buildEpubBuffer(options: EpubFixtureOptions = {}): Promise<Buffer> {
  const zip = await buildEpub(options);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Hostile spine documents, one hostile trait each, for tier 2 cases. */
export const EVIL_XHTML = {
  withScript: '<html><body><p>hola</p><script>alert(1)</script></body></html>',
  withIframe: '<html><body><iframe src="https://evil.example/x"></iframe></body></html>',
  withObject: '<html><body><object data="evil.swf"></object></body></html>',
  withEmbed: '<html><body><embed src="evil.swf"/></body></html>',
  withOnload: '<html><body onload="alert(1)"><p>hola</p></body></html>',
  withOnclick: '<html><body><p onclick="alert(1)">hola</p></body></html>',
  withJavascriptHref: '<html><body><a href="javascript:alert(1)">click</a></body></html>',
  withFileHref: '<html><body><a href="file:///etc/passwd">click</a></body></html>',
  withXxe: `<?xml version="1.0"?><!DOCTYPE html [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><html><body><p>&xxe;</p></body></html>`,
  withRemoteImage:
    '<html><body><img src="https://tracker.example/pixel.gif" alt="t" width="1" height="1"/></body></html>',
  withDataUriImage:
    '<html><body><img src="data:image/gif;base64,R0lGOD" alt="t"/></body></html>',
} as const;
