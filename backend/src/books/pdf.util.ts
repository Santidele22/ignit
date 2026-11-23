import { open } from 'node:fs/promises';

/**
 * Every PDF starts with the five magic bytes `%PDF-`; both the mimetype and
 * the original filename of a multipart upload are client-controlled, so the
 * stored file is verified against its content instead.
 */
const PDF_MAGIC_BYTES = Buffer.from('%PDF-');

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
