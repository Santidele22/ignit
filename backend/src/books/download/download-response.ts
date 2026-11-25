import { HttpStatus } from '@nestjs/common';
import type { BookDownload } from '../storage/book-storage.js';
import { EPUB_MIME_TYPE } from '../pdf.util.js';

/** MIME type whose responses get the hardened, sandboxed treatment (S2). */
export const PDF_MIME_TYPE = 'application/pdf';

/**
 * The subset of the Express response the file routes touch. `@Res()` is not
 * typed fully by Nest, so the controller hands the runtime Express response
 * over and only this module narrows it.
 */
export type DownloadResponse = {
  set(headers: Record<string, string>): unknown;
  status(code: number): { json(body: unknown): unknown };
  redirect(status: number, url: string): unknown;
  readonly headersSent: boolean;
  destroy(): void;
};

/** The stored-file metadata the response headers are built from. */
export type DownloadHeaders = {
  originalName: string;
  mimeType: string;
};

/**
 * Filename used in `Content-Disposition`. The stored name is client-controlled,
 * so quotes, backslashes, path separators and control characters (CR/LF would
 * split the header) are stripped before it is quoted; a served book file also
 * gets the extension enforced (`.pdf` by default, `.epub` for EPUB payloads,
 * `null` to keep the stored name as-is).
 */
export function dispositionFilename(
  originalName: string,
  options: { fallback?: string; extension?: string | null } = {},
): string {
  const { fallback = 'libro.pdf', extension = '.pdf' } = options;
  const cleaned = String(originalName ?? '')
    // Control characters first: CR/LF inside the quoted name would terminate
    // the header line and let the client inject extra headers.
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/["\\]/g, '')
    .replace(/[/;]/g, '_')
    .trim();
  const base = cleaned.length > 0 ? cleaned : fallback;

  if (!extension || base.toLowerCase().endsWith(extension.toLowerCase())) {
    return base;
  }
  return `${base}${extension}`;
}

/**
 * Response headers for one served book file (S2 reader hardening).
 *
 * PDFs are served `inline` — the reader is the only rendering path, so the
 * browser's native viewer opens the document — with `nosniff` and a
 * `sandbox` CSP so the document cannot script its way into the app's origin.
 * Any other payload (EPUB included) keeps the historical attachment
 * disposition, with the `.epub` extension enforced for EPUB payloads.
 */
export function downloadHeaders(
  originalName: string,
  mimeType: string,
): Record<string, string> {
  const filename = dispositionFilename(originalName);
  const headers: Record<string, string> = {
    'Content-Type': mimeType,
    'X-Content-Type-Options': 'nosniff',
  };

  if (isPdfMimeType(mimeType)) {
    headers['Content-Disposition'] = `inline; filename="${filename}"`;
    headers['Content-Security-Policy'] = 'sandbox';
  } else {
    const extension = isEpubMimeType(mimeType) ? '.epub' : null;
    headers['Content-Disposition'] = `attachment; filename="${dispositionFilename(
      originalName,
      { fallback: extension ? `libro${extension}` : 'archivo', extension },
    )}"`;
  }

  return headers;
}

/**
 * Delivers the resolved download: an S3 reference becomes a `302` to its
 * short-lived presigned URL (the bucket is private, so the bytes are never
 * proxied through this process), a local reference is streamed with the
 * hardened headers above.
 */
export function respondWithDownload(
  res: DownloadResponse,
  delivery: BookDownload,
  headers: DownloadHeaders,
): void {
  if (delivery.strategy === 's3') {
    res.redirect(HttpStatus.FOUND, delivery.url);
    return;
  }

  res.set(downloadHeaders(headers.originalName, headers.mimeType));
  // Every stream gets an error handler before piping: a read failure must
  // answer a controlled 404 (headers not sent yet) or close the socket
  // cleanly — never an unhandled 'error' event taking the process down.
  delivery.stream.on('error', () => {
    if (!res.headersSent) {
      res.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'El archivo solicitado no está disponible',
      });
    } else {
      res.destroy();
    }
  });
  delivery.stream.pipe(res as unknown as NodeJS.WritableStream);
}

function isPdfMimeType(mimeType: string): boolean {
  return baseMimeType(mimeType) === PDF_MIME_TYPE;
}

function isEpubMimeType(mimeType: string): boolean {
  return baseMimeType(mimeType) === EPUB_MIME_TYPE;
}

function baseMimeType(mimeType: string): string {
  return mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
}
