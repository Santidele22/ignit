import type { ReadingChunkType, ReadingInlineRun, ReadingMood } from '../reading/reading.types.js';

export const IGB1_MAGIC = 'IGB1';
export const IGB1_VERSION = 1;
export const IGB1_HEADER_BYTES = 18; // 4 (magic) + 1 (version) + 1 (flags) + 12 (nonce)
export const IGB1_NONCE_BYTES = 12;
export const IGB1_GCM_TAG_BYTES = 16;
export const IGB1_KEY_BYTES = 32;

export const IGB1_FLAG_BROTLI = 1 << 0; // 0 = gzip, 1 = brotli
export const IGB1_FLAG_ENCRYPTED = 1 << 1; // 0 = clear (Tier 1), 1 = AES-256-GCM (Tier 2/3)
export const IGB1_FLAG_CHUNKED = 1 << 2; // reserved for chapter-level chunking (Fase 3)

export type ContentTier = 'public_open' | 'private_user' | 'editorial_closed';
export type Igb1Compression = 'gzip' | 'brotli';

export interface CompactReadingChunk {
  i: string;
  t?: ReadingChunkType;
  p: number;
  o: number;
  x: string;
  m?: ReadingMood;
  q?: string[];
  l?: 1 | 2 | 3;
  r?: ReadingInlineRun[];
  ord?: 1;
  it?: string[];
  a?: 'center' | 'right';
}

export interface CompactReadingDocument {
  v: 1;
  b: string;
  p: number;
  o?: 1;
  ev?: number;
  ai?: 1;
  c: CompactReadingChunk[];
}

export interface Igb1Header {
  magic: string;
  version: number;
  flags: number;
  nonce: Buffer;
}

export interface Igb1EncodeOptions {
  bookId: string;
  tier: ContentTier;
  compression?: Igb1Compression;
  /** 32-byte AES-256 key. Required when tier is 'private_user' or 'editorial_closed'. */
  key?: Buffer;
  /** Optional deterministic 12-byte IV (for golden test vectors). Defaults to randomBytes(12). */
  iv?: Buffer;
}

export interface Igb1DecodeOptions {
  bookId: string;
  tier: ContentTier;
  /** 32-byte AES-256 key. Required when the IGB1 encrypted flag is set. */
  key?: Buffer;
}
