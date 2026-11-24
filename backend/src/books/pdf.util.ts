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

/**
 * Valid PDF version headers accepted by the firewall: ISO 32000-1 (`%PDF-1.0`
 * through `%PDF-1.7`) and ISO 32000-2 (`%PDF-2.0`), with a trailing non-digit
 * boundary so `%PDF-1.70` does not masquerade as `1.7`.
 */
const PDF_HEADER_PATTERN = /%PDF-(?:1\.[0-7]|2\.0)(?![0-9])/;

/**
 * Offset of the versioned `%PDF-1.x` / `%PDF-2.0` header inside the first 1024
 * bytes, or `-1` when the buffer carries no valid PDF header.
 */
export function findPdfHeader(buffer: Buffer): number {
  const windowText = buffer.subarray(0, PDF_HEADER_SCAN_WINDOW).toString('latin1');
  const match = PDF_HEADER_PATTERN.exec(windowText);
  return match ? match.index : -1;
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
