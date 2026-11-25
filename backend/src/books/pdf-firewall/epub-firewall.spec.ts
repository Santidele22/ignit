import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  EPUB_ANALYSIS_OPF_MINIMAL,
  READABLE_XHTML_FIXTURE,
  buildEpubBuffer,
  EVIL_XHTML,
} from './epub-firewall.fixtures.js';
import {
  inspectEpubBuffer,
  inspectEpubBufferWithPipeline,
} from './epub-firewall.service.js';

describe('epub-firewall tier 0 (ZIP & zip-bomb bounds)', () => {
  it('accepts a clean EPUB', async () => {
    const buffer = await buildEpubBuffer({ xhtml: READABLE_XHTML_FIXTURE });
    const verdict = await inspectEpubBuffer(buffer);
    expect(verdict.safe).toBe(true);
    expect(verdict.violations).toEqual([]);
    expect(verdict.spineDocumentCount).toBeGreaterThan(0);
  });

  it('rejects a non-ZIP payload without a PK signature', async () => {
    const verdict = await inspectEpubBuffer(Buffer.from('definitely not a zip'));
    expect(verdict.safe).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain('MISSING_EPUB_ZIP');
  });

  it('rejects a ZIP whose mimetype entry is not application/epub+zip', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/zip');
    zip.file('content.xhtml', READABLE_XHTML_FIXTURE);
    const verdict = await inspectEpubBuffer(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(verdict.safe).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain('MISSING_EPUB_MIMETYPE');
  });

  it('rejects a ZIP without a mimetype entry', async () => {
    const zip = new JSZip();
    zip.file('only.xhtml', READABLE_XHTML_FIXTURE);
    const verdict = await inspectEpubBuffer(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(verdict.safe).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain('MISSING_EPUB_MIMETYPE');
  });

  it('rejects path-traversal entry names (../)', async () => {
    const buffer = await buildEpubBuffer({
      xhtml: READABLE_XHTML_FIXTURE,
      extraEntries: [{ path: '../evil.txt', data: 'pwned' }],
    });
    const verdict = await inspectEpubBuffer(buffer);
    expect(verdict.safe).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain('PATH_TRAVERSAL');
    expect(
      verdict.violations.find((v) => v.code === 'PATH_TRAVERSAL')?.detail,
    ).toContain('..');
  });

  it('rejects absolute entry names', async () => {
    const buffer = await buildEpubBuffer({
      xhtml: READABLE_XHTML_FIXTURE,
      extraEntries: [{ path: '/etc/evil.txt', data: 'pwned' }],
    });
    const verdict = await inspectEpubBuffer(buffer);
    expect(verdict.safe).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain('PATH_TRAVERSAL');
  });

  it('rejects too many entries', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    for (let i = 0; i < 10_001; i += 1) {
      zip.file(`f/${i}.xhtml`, '<html/>');
    }
    const verdict = await inspectEpubBuffer(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(verdict.safe).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain('EPUB_ENTRY_LIMIT_EXCEEDED');
  });

  it('rejects a zip bomb (decompressed size beyond the budget)', async () => {
    const bombs = Buffer.alloc(1024 * 1024, 0); // highly compressible zeros
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    // ~400 MiB decompressed across entries with the default 256 MiB budget.
    for (let i = 0; i < 400; i += 1) {
      zip.file(`bomb/${i}.bin`, bombs);
    }
    const verdict = await inspectEpubBuffer(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(verdict.safe).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain('EPUB_ZIP_BOMB');
  });
});

describe('epub-firewall tier 1 (container/OPF & DRM)', () => {
  it('rejects a missing META-INF/container.xml', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    zip.file('content.opf', EPUB_ANALYSIS_OPF_MINIMAL);
    const verdict = await inspectEpubBuffer(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(verdict.safe).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain('MISSING_CONTAINER_XML');
  });

  it('rejects DRM (META-INF/encryption.xml with EncryptedData)', async () => {
    const buffer = await buildEpubBuffer({
      xhtml: READABLE_XHTML_FIXTURE,
      encryptionXml: '<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData/></encryption>',
    });
    const verdict = await inspectEpubBuffer(buffer);
    expect(verdict.safe).toBe(false);
    const codes = verdict.violations.map((v) => v.code);
    expect(codes).toContain('DRM_ENCRYPTED');
  });

  it('rejects a container.xml that does not resolve to an OPF', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    zip.file(
      'META-INF/container.xml',
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles/></container>',
    );
    zip.file('content.opf', EPUB_ANALYSIS_OPF_MINIMAL);
    const verdict = await inspectEpubBuffer(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(verdict.safe).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain('MISSING_OPF');
  });
});

describe('epub-firewall tier 2 (XHTML/XML active content)', () => {
  it('rejects <script> in a spine document', async () => {
    const buffer = await buildEpubBuffer({ xhtml: EVIL_XHTML.withScript });
    const verdict = await inspectEpubBuffer(buffer);
    expect(verdict.safe).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain('ACTIVE_CONTENT');
    for (const v of verdict.violations.filter((x) => x.code === 'ACTIVE_CONTENT')) {
      expect(v.detail).toMatch(/script/i);
    }
  });

  it('rejects <iframe>, <object> and <embed>', async () => {
    for (const xhtml of [EVIL_XHTML.withIframe, EVIL_XHTML.withObject, EVIL_XHTML.withEmbed]) {
      const buffer = await buildEpubBuffer({ xhtml });
      const verdict = await inspectEpubBuffer(buffer);
      expect(verdict.safe).toBe(false);
      expect(verdict.violations.map((v) => v.code)).toContain('ACTIVE_CONTENT');
    }
  });

  it('rejects on*= event handlers', async () => {
    const buffer = await buildEpubBuffer({ xhtml: EVIL_XHTML.withOnload });
    const verdict = await inspectEpubBuffer(buffer);
    expect(verdict.safe).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain('ACTIVE_CONTENT');
    expect(verdict.violations.some((v) => /onload/i.test(v.detail ?? ''))).toBe(true);
  });

  it('rejects javascript: and file: hrefs anywhere in the ZIP (nav, OPF, XHTML)', async () => {
    const buffer = await buildEpubBuffer({ xhtml: EVIL_XHTML.withJavascriptHref });
    const verdict = await inspectEpubBuffer(buffer);
    expect(verdict.safe).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain('SUSPICIOUS_URI');

    const opfBuffer = await buildEpubBuffer({
      xhtml: READABLE_XHTML_FIXTURE,
      navExtra: '<li><a href="javascript:alert(1)">nav</a></li>',
    });
    const opfVerdict = await inspectEpubBuffer(opfBuffer);
    expect(opfVerdict.safe).toBe(false);
    expect(opfVerdict.violations.map((v) => v.code)).toContain('SUSPICIOUS_URI');

    const fileBuffer = await buildEpubBuffer({ xhtml: EVIL_XHTML.withFileHref });
    const fileVerdict = await inspectEpubBuffer(fileBuffer);
    expect(fileVerdict.safe).toBe(false);
    expect(fileVerdict.violations.map((v) => v.code)).toContain('SUSPICIOUS_URI');
  });

  it('rejects XXE entities (<!ENTITY ... SYSTEM>)', async () => {
    const buffer = await buildEpubBuffer({ xhtml: EVIL_XHTML.withXxe });
    const verdict = await inspectEpubBuffer(buffer);
    expect(verdict.safe).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain('XXE_ENTITY');
  });

  it('rejects remote http(s) resources embedded in spine XHTML (tracking pixels)', async () => {
    const buffer = await buildEpubBuffer({ xhtml: EVIL_XHTML.withRemoteImage });
    const verdict = await inspectEpubBuffer(buffer);
    expect(verdict.safe).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain('REMOTE_RESOURCE');
  });

  it('allows <img src="relative.jpg"> for a declared manifest image', async () => {
    const buffer = await buildEpubBuffer({
      xhtml: '<html><body><p><img src="images/cover.jpg" alt="portada"/></p></body></html>',
    });
    const verdict = await inspectEpubBuffer(buffer);
    expect(verdict.safe).toBe(true);
  });

  it('rejects data:image tracking payloads inside XHTML', async () => {
    const buffer = await buildEpubBuffer({
      xhtml: '<html><body><img src="data:image/png;base64,iVBORw0KGgo=" alt="tracker"/></body></html>',
    });
    const verdict = await inspectEpubBuffer(buffer);
    expect(verdict.safe).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain('REMOTE_RESOURCE');
  });
});

describe('epub-firewall structured pipeline report', () => {
  it('reports tiers 0, 1 and 2 with per-check states', async () => {
    const buffer = await buildEpubBuffer({ xhtml: READABLE_XHTML_FIXTURE });
    const report = await inspectEpubBufferWithPipeline(buffer);
    expect(report.schemaVersion).toBe(1);
    expect(report.tiers.map((t) => t.index)).toEqual([0, 1, 2]);
    expect(report.tiers.every((t) => t.status === 'passed')).toBe(true);
    expect(report.tiers[0].checks.map((c) => c.id)).toEqual([
      'zip',
      'mimetype',
      'path-traversal',
      'entry-limits',
      'compression-ratio',
    ]);
    expect(report.tiers[1].checks.map((c) => c.id)).toEqual([
      'container',
      'opf',
      'drm',
    ]);
    expect(report.tiers[2].checks.map((c) => c.id)).toEqual([
      'xxe',
      'active-content',
      'uris',
      'remote-resources',
    ]);
  });

  it('marks later tiers skipped when tier 0 rejects', async () => {
    const report = await inspectEpubBufferWithPipeline(Buffer.from('not a zip'));
    expect(report.tiers[0].status).toBe('violation');
    expect(report.tiers[1].status).toBe('skipped');
    expect(report.tiers[2].status).toBe('skipped');
  });
});
