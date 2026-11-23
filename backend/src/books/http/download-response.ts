import { HttpStatus } from '@nestjs/common';
import type { BookDownload } from '../storage/book-storage.js';

/**
 * The subset of the Express response the download route touches. `@Res()` is
 * not typed fully by Nest, so the controller hands the runtime Express
 * response over and only this module narrows it.
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
 * Delivers the resolved download: an S3 reference becomes a `302` to its
 * short-lived presigned URL (the bucket is private, so the bytes are never
 * proxied through this process), a local reference is streamed as an
 * attachment with its stored mime type.
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

  res.set({
    'Content-Type': headers.mimeType,
    'Content-Disposition': `attachment; filename="${headers.originalName}"`,
  });
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
