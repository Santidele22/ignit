import 'reflect-metadata';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { Repository } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '../entities/book.entity.js';
import {
  buildEpubBuffer,
  EPUB_METADATA_OPF_URN,
  EVIL_XHTML,
} from '../pdf-firewall/epub-firewall.fixtures.js';
import type { PdfFirewallReport } from '../pdf-firewall/pdf-firewall.types.js';
import type { BookReadingDocument } from '../reading/reading.types.js';
import { EMPTY_READING_MESSAGE, ILLEGIBLE_READING_MESSAGE } from '../reading/reading.legibility.js';
import type { BookStorage } from '../storage/book-storage.js';
import { assertStoredBookFile, requireUploadedPdf } from '../http/uploaded-pdf.js';
import { attachBookFile, type UploadedPdf } from './book-file.js';

/** Wraps a spine body in the minimal XHTML document the EPUB extractor walks. */
function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Fixture</title></head>
<body>${body}</body>
</html>`;
}

/** A real one-page PDF with readable Spanish prose so extraction & legibility pass. */
async function cleanPdfBuffer(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(
    'En un lugar de la Mancha, de cuyo nombre no quiero acordarme, vivia un hidalgo de los de lanza en astillero.',
    { x: 50, y: 700, size: 12, font },
  );
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** A blank one-page PDF with no extractable text (simulates un-OCR'd scan). */
async function emptyPdfBuffer(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage();
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/**
 * `attachBookFile` end-to-end wiring (S6): the EPUB upload must run the EPUB
 * firewall, feed `reading.json` from the EPUB extractor, persist the canonical
 * mime type and prefill only the empty OPF metadata columns — while the PDF
 * path stays byte-identical.
 */
describe('attachBookFile format dispatch (S6)', () => {
  let dir: string;
  let previousUploadDir: string | undefined;
  let persist: ReturnType<typeof vi.fn>;
  let save: ReturnType<typeof vi.fn>;
  let bookStorage: BookStorage;
  let booksRepository: Repository<Book>;

  beforeEach(async () => {
    previousUploadDir = process.env.BOOKS_UPLOAD_DIR;
    dir = await mkdtemp(join(tmpdir(), 'book-file-epub-'));
    process.env.BOOKS_UPLOAD_DIR = dir;
    persist = vi.fn(async (_id: number, _file: { path: string }) => 'stored.epub');
    save = vi.fn(async (row: Book) => row);
    bookStorage = {
      strategy: 'local',
      persist,
      remove: vi.fn(async () => undefined),
      resolveDownload: vi.fn(),
    } as unknown as BookStorage;
    booksRepository = { save } as unknown as Repository<Book>;
  });

  afterEach(async () => {
    if (previousUploadDir === undefined) {
      delete process.env.BOOKS_UPLOAD_DIR;
    } else {
      process.env.BOOKS_UPLOAD_DIR = previousUploadDir;
    }
    await rm(dir, { recursive: true, force: true });
  });

  function emptyBook(overrides: Partial<Book> = {}): Book {
    return {
      id: 7,
      title: '',
      author: '',
      description: '',
      filePath: null,
      published: false,
      ownerId: 'dev-test-user',
      publisher: null,
      isbn: null,
      coverUrl: null,
      ...overrides,
    } as Book;
  }

  async function upload(name: string, bytes: Buffer, mimetype: string): Promise<UploadedPdf> {
    const path = join(dir, name);
    await writeFile(path, bytes);
    return { path, originalname: name, size: bytes.byteLength, mimetype };
  }

  it('persists an EPUB upload with its firewall report, reading sidecar and OPF metadata', async () => {
    const bytes = await buildEpubBuffer({ opf: EPUB_METADATA_OPF_URN });
    const file = await upload('manual.epub', bytes, 'application/epub+zip');
    const book = emptyBook();

    const saved = await attachBookFile(booksRepository, bookStorage, book, file);

    // Canonical mime type + synthetic page count from the extractor.
    expect(saved.mimeType).toBe('application/epub+zip');
    expect(saved.originalName).toBe('manual.epub');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0]?.[1]).toMatchObject({ mimetype: 'application/epub+zip' });

    // `reading.json` chunks come from the EPUB extractor.
    const reading = JSON.parse(
      await readFile(join(dir, '7', 'reading.json'), 'utf8'),
    ) as BookReadingDocument;
    expect(reading.bookId).toBe('7');
    expect(reading.chunks.length).toBeGreaterThan(0);
    expect(reading.chunks.map((chunk) => chunk.type)).toEqual(
      expect.arrayContaining(['toc', 'heading', 'para', 'quote', 'list', 'code']),
    );
    expect(reading.chunks.some((chunk) => chunk.text.includes('La Mancha'))).toBe(true);
    expect(saved.filePages).toBe(reading.pdfPages);
    expect(saved.filePages).toBeGreaterThanOrEqual(1);

    // The EPUB firewall ran and stored its per-tier report for /admin.
    const report = JSON.parse(
      await readFile(join(dir, '7', 'firewall.json'), 'utf8'),
    ) as PdfFirewallReport;
    expect(report.schemaVersion).toBe(1);
    expect(report.safe).toBe(true);
    expect(report.tiers.map((tier) => tier.status)).toEqual(['passed', 'passed', 'passed']);
    expect(report.tiers.map((tier) => (tier as { name?: string }).name)).toEqual([
      'zip',
      'container',
      'content',
    ]);

    // Empty columns took the OPF values.
    expect(saved.title).toBe('Manual de prueba');
    expect(saved.author).toBe('Autora Principal');
    expect(saved.publisher).toBe('Editorial Prueba');
    expect(saved.isbn).toBe('9783161484100');
    expect(saved.description).toBe('Un clásico intemporal & breve.');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('never overwrites metadata an admin already entered', async () => {
    const bytes = await buildEpubBuffer({ opf: EPUB_METADATA_OPF_URN });
    const file = await upload('manual.epub', bytes, 'application/epub+zip');
    const book = emptyBook({
      title: 'Título propio',
      author: 'Autor propio',
      publisher: 'Editorial propia',
      isbn: '1111111111',
      description: 'Descripción propia.',
    });

    const saved = await attachBookFile(booksRepository, bookStorage, book, file);

    expect(saved.title).toBe('Título propio');
    expect(saved.author).toBe('Autor propio');
    expect(saved.publisher).toBe('Editorial propia');
    expect(saved.isbn).toBe('1111111111');
    expect(saved.description).toBe('Descripción propia.');
  });

  it('rejects a hostile EPUB with the firewall message and never stores it', async () => {
    const bytes = await buildEpubBuffer({ xhtml: EVIL_XHTML.withScript });
    const file = await upload('hostil.epub', bytes, 'application/epub+zip');

    const error = await attachBookFile(booksRepository, bookStorage, emptyBook(), file).catch(
      (reason: unknown) => reason,
    );

    expect((error as { status?: number }).status).toBe(400);
    expect(String((error as Error).message)).toContain(
      'El EPUB fue rechazado por el filtro de seguridad: ACTIVE_CONTENT',
    );
    expect(String((error as Error).message)).toContain('content.xhtml');
    expect(persist).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    await expect(access(file.path)).rejects.toThrow();

    const report = JSON.parse(
      await readFile(join(dir, '7', 'firewall.json'), 'utf8'),
    ) as PdfFirewallReport;
    expect(report.safe).toBe(false);
  });

  it('rejects a mojibake EPUB with the legibility message', async () => {
    const bytes = await buildEpubBuffer({
      xhtml: xhtml(`<p>${'"#$%&\' $(!")*! '.repeat(12)}</p>`),
    });
    const file = await upload('roto.epub', bytes, 'application/epub+zip');

    const error = await attachBookFile(booksRepository, bookStorage, emptyBook(), file).catch(
      (reason: unknown) => reason,
    );

    expect((error as { status?: number }).status).toBe(400);
    expect((error as Error).message).toBe(ILLEGIBLE_READING_MESSAGE);
    expect(persist).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    await expect(access(file.path)).rejects.toThrow();
  });

  it('keeps the PDF path byte-identical: mime type, firewall pages and PDF report tiers', async () => {
    const bytes = await cleanPdfBuffer();
    const file = await upload('limpio.pdf', bytes, 'application/pdf');
    const book = emptyBook({ title: 'Título propio', author: 'Autor propio' });

    const saved = await attachBookFile(booksRepository, bookStorage, book, file);

    expect(saved.mimeType).toBe('application/pdf');
    expect(saved.filePages).toBe(1);
    expect(saved.title).toBe('Título propio');
    expect(saved.author).toBe('Autor propio');
    expect(persist.mock.calls[0]?.[1]).toMatchObject({ mimetype: 'application/pdf' });

    const report = JSON.parse(
      await readFile(join(dir, '7', 'firewall.json'), 'utf8'),
    ) as PdfFirewallReport;
    expect(report.safe).toBe(true);
    expect(report.tiers.map((tier) => tier.name)).toEqual(['header', 'lexical', 'structure']);
  });

  it('rejects an empty / zero-text PDF before persisting it', async () => {
    const bytes = await emptyPdfBuffer();
    const file = await upload('vacio.pdf', bytes, 'application/pdf');
    const book = emptyBook({ title: 'Libro vacío', author: 'Autor' });

    const error = await attachBookFile(booksRepository, bookStorage, book, file).catch(
      (reason: unknown) => reason,
    );

    expect((error as { status?: number }).status).toBe(400);
    expect((error as Error).message).toBe(EMPTY_READING_MESSAGE);
    expect(persist).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    await expect(access(file.path)).rejects.toThrow();
  });

  it('keeps publishRequested fail-closed when LLM is unconfigured/skipped', async () => {
    const bytes = await cleanPdfBuffer();
    const file = await upload('dominio-publico.pdf', bytes, 'application/pdf');
    const book = emptyBook({
      title: 'Don Quijote',
      author: 'Miguel de Cervantes',
      license: 'Dominio público',
      published: false,
    });

    const saved = await attachBookFile(booksRepository, bookStorage, book, file, {
      publishRequested: true,
    });

    expect(saved.published).toBe(false);
    expect(saved.reviewStatus).toBe('pending');
  });
});

/**
 * The upload interceptor only knows the client-claimed mime type, so the bytes
 * are verified here: `%PDF-` keeps the PDF path, and a ZIP is only accepted when
 * it carries the OCF `mimetype` entry (never on the bare `PK` signature).
 */
describe('assertStoredBookFile (upload gate)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'book-gate-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function upload(name: string, bytes: Buffer): Promise<UploadedPdf> {
    const path = join(dir, name);
    await writeFile(path, bytes);
    return {
      path,
      originalname: name,
      size: bytes.byteLength,
      mimetype: 'application/octet-stream',
    };
  }

  it('accepts a real PDF and keeps the temp file', async () => {
    const file = await upload('libro.pdf', await cleanPdfBuffer());

    await expect(assertStoredBookFile(file)).resolves.toBeUndefined();
    await expect(access(file.path)).resolves.toBeUndefined();
  });

  it('accepts an EPUB whose first ZIP entry proves the OCF mimetype', async () => {
    const file = await upload('libro.epub', await buildEpubBuffer());

    await expect(assertStoredBookFile(file)).resolves.toBeUndefined();
    await expect(access(file.path)).resolves.toBeUndefined();
  });

  it('rejects a plain ZIP without the epub mimetype proof and drops it', async () => {
    const zip = new JSZip();
    zip.file('documento.txt', 'hola');
    const file = await upload('paquete.zip', await zip.generateAsync({ type: 'nodebuffer' }));

    await expect(assertStoredBookFile(file)).rejects.toMatchObject({
      status: 400,
      message: 'El archivo subido no es un PDF o EPUB válido',
    });
    await expect(access(file.path)).rejects.toThrow();
  });

  it('rejects bytes that are neither PDF nor EPUB', async () => {
    const file = await upload('notas.txt', Buffer.from('solo texto plano'));

    await expect(assertStoredBookFile(file)).rejects.toMatchObject({ status: 400 });
    await expect(access(file.path)).rejects.toThrow();
  });

  it('answers both formats when multer rejected the upload body', () => {
    expect(() => requireUploadedPdf(undefined)).toThrow('Solo se aceptan archivos PDF o EPUB');
  });
});
