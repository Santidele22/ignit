import { open } from 'node:fs/promises';

/**
 * Every PDF starts with the five magic bytes `%PDF-`; both the mimetype and
 * the original filename of a multipart upload are client-controlled, so the
 * stored file is verified against its content instead.
 */
const PDF_MAGIC_BYTES = Buffer.from('%PDF-');

/**
 * A PDF header — `%PDF-1.x` — may be preceded by up to 1024 bytes of junk
 * (ISO 32000-1, §7.5.2), so validation scans that window instead of only the
 * first bytes the magic-byte check reads.
 */
export const PDF_HEADER_SCAN_WINDOW = 1024;

const PDF_HEADER_SIGNATURE = '%PDF-1.';

/**
 * Offset of the `%PDF-1.` header inside the first 1024 bytes, or `-1` when the
 * buffer carries no versioned PDF header (an empty or spoofed file).
 */
export function findPdfHeader(buffer: Buffer): number {
  return buffer.subarray(0, PDF_HEADER_SCAN_WINDOW).indexOf(PDF_HEADER_SIGNATURE);
}

export async function hasPdfMagicBytes(filePath: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, 'r');
    const header = Buffer.alloc(PDF_MAGIC_BYTES.length);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return (
      bytesRead === PDF_MAGIC_BYTES.length &&
      header.equals(PDF_MAGIC_BYTES)
    );
  } catch {
    // A vanished or unreadable file is not a PDF we can serve.
    return false;
  } finally {
    await handle?.close();
  }
}
