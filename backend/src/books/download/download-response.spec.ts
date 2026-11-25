import 'reflect-metadata';
import { Readable, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { BookDownload } from '../storage/book-storage.js';
import { dispositionFilename, downloadHeaders, respondWithDownload } from './download-response.js';

/** Minimal Express response stand-in that records headers and bytes. */
class FakeResponse extends Writable {
  readonly headers: Record<string, string> = {};
  readonly chunks: Buffer[] = [];
  redirected: { status: number; url: string } | null = null;
  failingStatus: { code: number; body: unknown } | null = null;
  destroyed = false;

  set(headers: Record<string, string>): this {
    Object.assign(this.headers, headers);
    return this;
  }

  status(code: number) {
    const self = this;
    return {
      json(body: unknown) {
        self.failingStatus = { code, body };
        return self;
      },
    };
  }

  redirect(status: number, url: string): this {
    this.redirected = { status, url };
    return this;
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, done: () => void): void {
    this.chunks.push(Buffer.from(chunk));
    done();
  }

  override destroy(): this {
    this.destroyed = true;
    return this;
  }
}

function streamed(text: string): BookDownload {
  return { strategy: 'local', stream: Readable.from([Buffer.from(text)]) };
}

function finished(response: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    response.on('finish', () => resolve());
    response.on('error', reject);
  });
}

describe('downloadHeaders (S2 reader hardening)', () => {
  it('serves a PDF inline with nosniff and a sandboxed document', () => {
    expect(downloadHeaders('clean-code.pdf', 'application/pdf')).toEqual({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="clean-code.pdf"',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
    });
  });

  it('sanitizes client-controlled names so they cannot break out of the header', () => {
    const headers = downloadHeaders('..\\evil"\r\nX: 1.pdf', 'application/pdf');
    const disposition = headers['Content-Disposition'] ?? '';
    const filename = /filename="([^"]*)"/.exec(disposition)?.[1] ?? '';

    expect(disposition.startsWith('inline; filename="')).toBe(true);
    expect(filename).not.toMatch(/[\r\n"\\;]/);
    expect(filename.endsWith('.pdf')).toBe(true);
  });

  it('appends the pdf extension and falls back when the name is empty', () => {
    expect(dispositionFilename('invierno')).toBe('invierno.pdf');
    expect(dispositionFilename('   ')).toBe('libro.pdf');
  });

  it('serves an EPUB as an attachment with the .epub filename and no sandbox', () => {
    expect(downloadHeaders('libro.epub', 'application/epub+zip')).toEqual({
      'Content-Type': 'application/epub+zip',
      'Content-Disposition': 'attachment; filename="libro.epub"',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  it('forces the .epub extension when the stored name carries none', () => {
    expect(downloadHeaders('invierno', 'application/epub+zip')['Content-Disposition']).toBe(
      'attachment; filename="invierno.epub"',
    );
    expect(downloadHeaders('   ', 'application/epub+zip')['Content-Disposition']).toBe(
      'attachment; filename="libro.epub"',
    );
  });

  it('keeps an attachment disposition for non-PDF payloads', () => {
    expect(downloadHeaders('scan.png', 'image/png')).toEqual({
      'Content-Type': 'image/png',
      'Content-Disposition': 'attachment; filename="scan.png"',
      'X-Content-Type-Options': 'nosniff',
    });
  });
});

describe('respondWithDownload', () => {
  it('streams the local PDF with the hardened headers', async () => {
    const response = new FakeResponse();

    respondWithDownload(response, streamed('%PDF-1.4'), {
      originalName: 'invierno.pdf',
      mimeType: 'application/pdf',
    });
    await finished(response);

    expect(response.headers).toEqual({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="invierno.pdf"',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
    });
    expect(Buffer.concat(response.chunks).toString()).toBe('%PDF-1.4');
  });

  it('answers 404 when the stream fails before any header was sent', async () => {
    const response = new FakeResponse();
    const failing = new Readable({
      read() {
        this.destroy(new Error('disk vanished'));
      },
    });

    respondWithDownload(response, { strategy: 'local', stream: failing }, {
      originalName: 'invierno.pdf',
      mimeType: 'application/pdf',
    });
    await vi.waitFor(() => expect(response.failingStatus).not.toBeNull());

    expect(response.failingStatus?.code).toBe(404);
    expect(response.failingStatus?.body).toMatchObject({ statusCode: 404 });
  });

  it('redirects an S3 reference to its presigned URL without PDF headers', () => {
    const response = new FakeResponse();

    respondWithDownload(response, { strategy: 's3', url: 'https://bucket.test/x.pdf' }, {
      originalName: 'invierno.pdf',
      mimeType: 'application/pdf',
    });

    expect(response.redirected).toEqual({ status: 302, url: 'https://bucket.test/x.pdf' });
    expect(response.headers).toEqual({});
  });
});
