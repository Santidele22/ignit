import 'reflect-metadata';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { PDFDocument, PDFName, PDFNumber, StandardFonts } from 'pdf-lib';
import type { Repository } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '../entities/book.entity.js';
import { attachBookFile, type UploadedPdf } from '../lib/book-file.js';
import type { BookStorage } from '../storage/book-storage.js';
import { findForbiddenNames, normalizePdfNames } from './pdf-firewall.rules.js';
import { assertSafePdfFile, inspectPdfBuffer } from './pdf-firewall.service.js';

/** A structurally valid PDF built by `pdf-lib` itself (no active content). */
async function cleanPdfBuffer(pageCount = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let page = 0; page < pageCount; page += 1) {
    doc.addPage();
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** Minimal header-bearing literal; tier 1 rejects it before any structural parse. */
function rawPdf(body: string): Buffer {
  return Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${body}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}

describe('pdf-firewall rules (tier 1 helpers)', () => {
  it('decodes #XX name escapes case-insensitively', () => {
    expect(normalizePdfNames('/#4a#61#76#61#53#63#72#69#70#74')).toBe('/JavaScript');
    expect(normalizePdfNames('/#4A#61#76#61#53#63#72#69#70#74')).toBe('/JavaScript');
    // A decoded escape can itself introduce a name delimiter.
    expect(normalizePdfNames('/a#2fb')).toBe('/a/b');
    expect(normalizePdfNames('/plain')).toBe('/plain');
  });

  it('finds forbidden dictionary names in raw bytes', () => {
    expect(findForbiddenNames('<< /Type /Action /S /JavaScript >>')).toEqual(['JavaScript']);
    expect(findForbiddenNames('<< /S /JS /OpenAction 4 0 R >>')).toEqual(['JS', 'OpenAction']);
    expect(findForbiddenNames('/#4a#61#76#61#53#63#72#69#70#74')).toEqual(['JavaScript']);
    expect(findForbiddenNames('trailer << /Encrypt 2 0 R >>')).toEqual(['Encrypt']);
  });

  it('ignores plain text, longer names and unterminated-looking prefixes', () => {
    // Only `/`-prefixed dictionary names are scanned; prose never matches.
    expect(findForbiddenNames('(El manual de JavaScript y su /JSX sustituto)')).toEqual([]);
    expect(findForbiddenNames('<< /AAPL /JSX /EFX /EFile /LaunchPad /3DX >>')).toEqual([]);
  });

  it('still matches short names that are real name tokens', () => {
    expect(findForbiddenNames('<< /EF << /F 3 0 R >> >>')).toEqual(['EF']);
    expect(findForbiddenNames('<< /AA << /O 1 >> >>')).toEqual(['AA']);
    expect(findForbiddenNames('<< /3D 2 0 R >>')).toEqual(['3D']);
  });
});

describe('inspectPdfBuffer tier 0 (header sanity and polyglots)', () => {
  it('accepts a clean single-page PDF', async () => {
    const verdict = await inspectPdfBuffer(await cleanPdfBuffer());

    expect(verdict).toEqual({ safe: true, pageCount: 1, violations: [] });
  });

  it('accepts junk before the header as long as it sits inside the first 1024 bytes', async () => {
    const prefixed = Buffer.concat([Buffer.from('IGNORED-PREAMBLE\n'), await cleanPdfBuffer()]);

    const verdict = await inspectPdfBuffer(prefixed);

    expect(verdict.safe).toBe(true);
    expect(verdict.pageCount).toBe(1);
  });

  it('rejects a file whose header is not inside the first 1024 bytes', async () => {
    const verdict = await inspectPdfBuffer(Buffer.from(`${' '.repeat(1100)}%PDF-1.7\n`));

    expect(verdict.safe).toBe(false);
    expect(verdict.violations.map((violation) => violation.code)).toContain('MISSING_PDF_HEADER');
  });

  it.each([
    ['ZIP', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
    ['ELF', Buffer.from([0x7f, 0x45, 0x4c, 0x46])],
    ['MACH-O', Buffer.from([0xcf, 0xfa, 0xed, 0xfe])],
    ['HTML', Buffer.from('<!DOCTYPE html><html><body>')],
  ])('rejects a %s|PDF polyglot', async (label, prefix) => {
    const verdict = await inspectPdfBuffer(Buffer.concat([prefix, await cleanPdfBuffer()]));

    expect(verdict.safe).toBe(false);
    expect(verdict.violations).toContainEqual({
      code: 'POLYGLOT',
      detail: label,
    });
  });
});

describe('inspectPdfBuffer tier 1 (lexical scan of the raw bytes)', () => {
  it('rejects hex-escaped active content names', async () => {
    const verdict = await inspectPdfBuffer(rawPdf('<< /OpenAction << /S /#4a#61#76#61#53#63#72#69#70#74 >> >>'));

    expect(verdict.safe).toBe(false);
    expect(verdict.violations).toContainEqual({ code: 'ACTIVE_CONTENT_KEY', detail: '/JavaScript' });
  });

  it('always rejects /Encrypt because encrypted streams cannot be inspected', async () => {
    const verdict = await inspectPdfBuffer(rawPdf('/Encrypt << /Filter /Standard >>'));

    expect(verdict.safe).toBe(false);
    expect(verdict.violations).toContainEqual({ code: 'ENCRYPTED', detail: '/Encrypt' });
  });

  it('rejects a real /JS dictionary name', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.catalog.set(PDFName.of('JS'), PDFNumber.of(1));

    const verdict = await inspectPdfBuffer(Buffer.from(await doc.save({ useObjectStreams: false })));

    expect(verdict.safe).toBe(false);
    expect(verdict.violations).toContainEqual({ code: 'ACTIVE_CONTENT_KEY', detail: '/JS' });
  });

  it('rejects /OpenAction injected straight into the catalog', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.catalog.set(
      PDFName.of('OpenAction'),
      doc.context.obj({ Type: 'Action', S: 'Launch', F: 'calc.exe' }),
    );

    const verdict = await inspectPdfBuffer(Buffer.from(await doc.save({ useObjectStreams: false })));

    expect(verdict.safe).toBe(false);
    expect(verdict.violations.map((violation) => violation.detail)).toContain('/OpenAction');
  });

  it('keeps a PDF whose only JavaScript-looking bytes are prose and a longer /JSX name', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('JavaScript is mentioned in this manual, and /JSX is just a name.', {
      font,
      size: 10,
    });
    doc.catalog.set(PDFName.of('JSX'), PDFNumber.of(1));

    const verdict = await inspectPdfBuffer(Buffer.from(await doc.save({ useObjectStreams: false })));

    expect(verdict).toEqual({ safe: true, pageCount: 1, violations: [] });
  });
});

describe('inspectPdfBuffer tier 2 (structural traversal)', () => {
  it('finds active content hidden inside a compressed object stream and nested arrays', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.catalog.set(
      PDFName.of('OpenAction'),
      doc.context.obj([
        { Type: 'Action', S: 'JavaScript', JS: 'app.alert(document.cookie)' },
        { Type: 'Action', S: 'JavaScript', JS: 'app.alert(2)' },
      ]),
    );
    const buffer = Buffer.from(await doc.save({ useObjectStreams: true }));

    // Sanity: the lexical tier cannot see these names, so only the AST walk can.
    expect(buffer.toString('latin1')).not.toContain('/JavaScript');

    const verdict = await inspectPdfBuffer(buffer);

    expect(verdict.safe).toBe(false);
    expect(verdict.violations).toContainEqual({ code: 'ACTIVE_CONTENT_KEY', detail: '/JavaScript' });
  });

  it('rejects a malformed PDF as hostile', async () => {
    const verdict = await inspectPdfBuffer(Buffer.from('%PDF-1.7\nnot a pdf at all\n'));

    expect(verdict.safe).toBe(false);
    expect(verdict.violations[0]?.code).toBe('PARSE_ERROR');
    expect(verdict.pageCount).toBe(0);
  });

  it('rejects a document outside the page-count bounds', async () => {
    const previous = process.env.MAX_FIREWALL_PAGES;
    process.env.MAX_FIREWALL_PAGES = '1';
    try {
      const verdict = await inspectPdfBuffer(await cleanPdfBuffer(2));

      expect(verdict.safe).toBe(false);
      expect(verdict.pageCount).toBe(2);
      expect(verdict.violations).toContainEqual({
        code: 'PAGE_COUNT_OUT_OF_BOUNDS',
        detail: '2 páginas (máximo 1)',
      });
    } finally {
      if (previous === undefined) {
        delete process.env.MAX_FIREWALL_PAGES;
      } else {
        process.env.MAX_FIREWALL_PAGES = previous;
      }
    }
  });
});

describe('assertSafePdfFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pdf-firewall-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function write(name: string, content: Buffer | string) {
    const path = join(dir, name);
    await writeFile(path, content);
    return path;
  }

  it('resolves and keeps the temp file for a clean PDF', async () => {
    const path = await write('clean.pdf', await cleanPdfBuffer());

    await expect(assertSafePdfFile(path)).resolves.toBeUndefined();
    await expect(access(path)).resolves.toBeUndefined();
  });

  it('answers 400 with the Spanish firewall message and drops the temp file', async () => {
    const path = await write('hostile.pdf', rawPdf('<< /S /JavaScript >>'));

    const error = await assertSafePdfFile(path).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getStatus()).toBe(400);
    expect((error as BadRequestException).message).toBe(
      'El PDF fue rechazado por el filtro de seguridad: ACTIVE_CONTENT_KEY /JavaScript. Eliminá el contenido activo y volvé a subirlo.',
    );
    await expect(access(path)).rejects.toThrow();
  });
});

describe('attachBookFile firewall wiring', () => {
  let dir: string;
  let persist: ReturnType<typeof vi.fn>;
  let save: ReturnType<typeof vi.fn>;
  let bookStorage: BookStorage;
  let booksRepository: Repository<Book>;
  let book: Book;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pdf-firewall-attach-'));
    persist = vi.fn(async () => 'stored.pdf');
    save = vi.fn(async (row: Book) => row);
    bookStorage = {
      strategy: 'local',
      persist,
      remove: vi.fn(async () => undefined),
      resolveDownload: vi.fn(),
    } as unknown as BookStorage;
    booksRepository = { save } as unknown as Repository<Book>;
    book = { id: 7, filePath: null, published: false, ownerId: 'dev-test-user' } as Book;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects a hostile upload before it ever reaches storage', async () => {
    const path = join(dir, 'hostile.pdf');
    await writeFile(path, rawPdf('<< /OpenAction << /S /JavaScript >> >>'));
    const file: UploadedPdf = {
      path,
      originalname: 'hostile.pdf',
      size: 120,
      mimetype: 'application/pdf',
    };

    await expect(attachBookFile(booksRepository, bookStorage, book, file)).rejects.toMatchObject({
      status: 400,
    });
    expect(persist).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    await expect(access(path)).rejects.toThrow();
  });
});
