/**
 * Deterministic ZIP central-directory reader for the EPUB firewall (S4 tier 0).
 *
 * Only the central directory is walked: entry names, sizes and bounds are read
 * without decompressing anything, so a hostile archive cannot force
 * decompression work before its reported sizes are validated.
 */

export type ZipEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

const EOCD_SIGNATURE = 0x06054b50; // PK\x05\x06
const CENTRAL_HEADER_SIGNATURE = 0x02014b50; // PK\x01\x02
/** Fixed byte length of the central-directory header before variable fields. */
const CENTRAL_HEADER_FIXED = 46;
/** The EOCD record is 22 bytes, so the comment (up to 64 KiB) hides it well. */
const EOCD_SCAN_WINDOW = 65_536 + 22;

/** ZIP64 markers that mean the standard fields are unusable for bounds. */
const markers = (raw: number) => raw === 0xffff || raw === 0xffffffff;

export class ZipBoundsError extends Error {}

/**
 * Reads every central-directory entry of a ZIP buffer, ordered by their
 * directory appearance. Throws `ZipBoundsError` on a missing/damaged directory
 * or ZIP64 archives (whose real bounds cannot be read without ZIP64 support).
 */
export function parseZipCentralDirectory(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findEocdOffset(buffer);
  if (eocdOffset < 0) {
    throw new ZipBoundsError('sin registro End of Central Directory');
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  if (markers(totalEntries) || markers(cdOffset) || markers(cdSize)) {
    throw new ZipBoundsError('archivo ZIP64 no soportado');
  }
  if (cdOffset + cdSize > buffer.length) {
    throw new ZipBoundsError('directorio central fuera de los límites del archivo');
  }

  const entries: ZipEntry[] = [];
  let cursor = cdOffset;
  const cdEnd = cdOffset + cdSize;
  while (cursor + CENTRAL_HEADER_FIXED <= cdEnd) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_HEADER_SIGNATURE) {
      throw new ZipBoundsError('entrada del directorio central dañada');
    }
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    entries.push({
      name: buffer.subarray(cursor + CENTRAL_HEADER_FIXED, cursor + CENTRAL_HEADER_FIXED + nameLength).toString('utf8'),
      compressionMethod: buffer.readUInt16LE(cursor + 10),
      compressedSize: buffer.readUInt32LE(cursor + 20),
      uncompressedSize: buffer.readUInt32LE(cursor + 24),
      localHeaderOffset: buffer.readUInt32LE(cursor + 42),
    });
    cursor += CENTRAL_HEADER_FIXED + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEocdOffset(buffer: Buffer): number {
  const start = Math.max(0, buffer.length - EOCD_SCAN_WINDOW);
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      return i;
    }
  }
  return -1;
}

/**
 * True when the entry name escapes its container: any parent-directory
 * segment, an absolute path, or Windows drive/shared-path syntax.
 */
export function isPathTraversalEntry(name: string): boolean {
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    return true;
  }
  return normalized.split('/').some((segment) => segment === '..');
}
