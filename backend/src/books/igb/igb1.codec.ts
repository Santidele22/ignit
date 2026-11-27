import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants, gunzipSync, gzipSync } from 'node:zlib';
import type { BookReadingDocument } from '../reading/reading.types.js';
import { compactReadingDocument, expandReadingDocument } from './igb1.compactor.js';
import {
  type CompactReadingDocument,
  type ContentTier,
  IGB1_FLAG_BROTLI,
  IGB1_FLAG_ENCRYPTED,
  IGB1_GCM_TAG_BYTES,
  IGB1_HEADER_BYTES,
  IGB1_KEY_BYTES,
  IGB1_MAGIC,
  IGB1_NONCE_BYTES,
  IGB1_VERSION,
  type Igb1Compression,
  type Igb1DecodeOptions,
  type Igb1EncodeOptions,
  type Igb1Header,
} from './igb1.types.js';

export function buildIgb1Aad(bookId: string, version: number, tier: ContentTier): Buffer {
  return Buffer.from(`${bookId}|${version}|${tier}`, 'utf8');
}

function compressPayload(raw: Buffer, compression: Igb1Compression): Buffer {
  if (compression === 'brotli') {
    return brotliCompressSync(raw, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9 },
    });
  }
  return gzipSync(raw, { level: 9 });
}

function decompressPayload(compressed: Buffer, useBrotli: boolean): Buffer {
  return useBrotli ? brotliDecompressSync(compressed) : gunzipSync(compressed);
}

export function parseIgb1Header(buf: Buffer): Igb1Header {
  if (buf.byteLength < IGB1_HEADER_BYTES) {
    throw new Error(`Invalid IGB1 buffer: expected at least ${IGB1_HEADER_BYTES} bytes, got ${buf.byteLength}`);
  }
  const magic = buf.subarray(0, 4).toString('ascii');
  if (magic !== IGB1_MAGIC) {
    throw new Error(`Invalid IGB1 magic: expected "${IGB1_MAGIC}", got "${magic}"`);
  }
  const version = buf.readUInt8(4);
  if (version !== IGB1_VERSION) {
    throw new Error(`Unsupported IGB1 version: ${version}`);
  }
  const flags = buf.readUInt8(5);
  const nonce = Buffer.from(buf.subarray(6, IGB1_HEADER_BYTES));
  return { magic, version, flags, nonce };
}

export function encodeIgb1(doc: BookReadingDocument, options: Igb1EncodeOptions): Buffer {
  const compression: Igb1Compression = options.compression ?? 'gzip';
  const encrypted = options.tier !== 'public_open';

  if (encrypted) {
    if (!options.key || options.key.byteLength !== IGB1_KEY_BYTES) {
      throw new Error(`IGB1 encryption requires a ${IGB1_KEY_BYTES}-byte AES-256 key`);
    }
    if (options.iv && options.iv.byteLength !== IGB1_NONCE_BYTES) {
      throw new Error(`IGB1 IV must be ${IGB1_NONCE_BYTES} bytes`);
    }
  }

  const compact = compactReadingDocument(doc);
  const jsonBytes = Buffer.from(JSON.stringify(compact), 'utf8');
  const compressed = compressPayload(jsonBytes, compression);

  let flags = 0;
  if (compression === 'brotli') flags |= IGB1_FLAG_BROTLI;
  if (encrypted) flags |= IGB1_FLAG_ENCRYPTED;

  const nonce = encrypted ? (options.iv ?? randomBytes(IGB1_NONCE_BYTES)) : Buffer.alloc(IGB1_NONCE_BYTES);
  const header = Buffer.alloc(IGB1_HEADER_BYTES);
  header.write(IGB1_MAGIC, 0, 4, 'ascii');
  header.writeUInt8(IGB1_VERSION, 4);
  header.writeUInt8(flags, 5);
  nonce.copy(header, 6);

  if (!encrypted) {
    return Buffer.concat([header, compressed]);
  }

  const cipher = createCipheriv('aes-256-gcm', options.key!, nonce);
  cipher.setAAD(buildIgb1Aad(options.bookId, IGB1_VERSION, options.tier));
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([header, ciphertext, tag]);
}

export function decodeIgb1(buf: Buffer, options: Igb1DecodeOptions): BookReadingDocument {
  const header = parseIgb1Header(buf);
  const encrypted = Boolean(header.flags & IGB1_FLAG_ENCRYPTED);
  const useBrotli = Boolean(header.flags & IGB1_FLAG_BROTLI);

  let compressed: Buffer;
  if (!encrypted) {
    compressed = buf.subarray(IGB1_HEADER_BYTES);
  } else {
    if (!options.key || options.key.byteLength !== IGB1_KEY_BYTES) {
      throw new Error(`IGB1 decryption requires a ${IGB1_KEY_BYTES}-byte AES-256 key`);
    }
    if (buf.byteLength < IGB1_HEADER_BYTES + IGB1_GCM_TAG_BYTES) {
      throw new Error('Invalid encrypted IGB1 buffer: missing GCM auth tag');
    }
    const tagStart = buf.byteLength - IGB1_GCM_TAG_BYTES;
    const ciphertext = buf.subarray(IGB1_HEADER_BYTES, tagStart);
    const tag = buf.subarray(tagStart);

    const decipher = createDecipheriv('aes-256-gcm', options.key, header.nonce);
    decipher.setAAD(buildIgb1Aad(options.bookId, header.version, options.tier));
    decipher.setAuthTag(tag);
    compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  const jsonStr = decompressPayload(compressed, useBrotli).toString('utf8');
  const compact = JSON.parse(jsonStr) as CompactReadingDocument;
  return expandReadingDocument(compact);
}
