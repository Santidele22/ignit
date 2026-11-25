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

const CONTAINER_XML = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

export type EpubFixtureOptions = {
  /** Spine document body (replaces `content.xhtml`). */
  xhtml?: string;
  /** OPF package document (replaces the minimal one). */
  opf?: string;
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
  zip.file('META-INF/container.xml', CONTAINER_XML);
  zip.file('content.opf', options.opf ?? EPUB_ANALYSIS_OPF_MINIMAL);
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
