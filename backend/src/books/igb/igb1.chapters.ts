import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { BookReadingDocument, ReadingChunk } from '../reading/reading.types.js';
import {
  IGB1_GCM_TAG_BYTES,
  IGB1_KEY_BYTES,
  IGB1_NONCE_BYTES,
  IGB1_VERSION,
} from './igb1.types.js';

export interface EncryptedChapterPacket {
  chapterIndex: number;
  title: string;
  ivBase64: string;
  ciphertextBase64: string;
}

export interface ChapterChunkedIgb1Envelope {
  magic: 'IGB1-CH';
  version: number;
  bookId: string;
  tier: 'editorial_closed';
  chapters: EncryptedChapterPacket[];
}

export function deriveChapterIv(baseIv: Buffer, chapterIndex: number): Buffer {
  if (baseIv.byteLength !== IGB1_NONCE_BYTES) {
    throw new Error(`Base IV must be ${IGB1_NONCE_BYTES} bytes`);
  }
  const derived = Buffer.from(baseIv);
  const idx = chapterIndex >>> 0;
  derived[0] ^= (idx >>> 24) & 0xff;
  derived[1] ^= (idx >>> 16) & 0xff;
  derived[2] ^= (idx >>> 8) & 0xff;
  derived[3] ^= idx & 0xff;
  return derived;
}

export function buildChapterAad(bookId: string, chapterIndex: number): Buffer {
  return Buffer.from(`${bookId}|${IGB1_VERSION}|editorial_closed|ch:${chapterIndex}`, 'utf8');
}

export function splitDocumentIntoChapters(
  doc: BookReadingDocument,
): Array<{ title: string; chunks: ReadingChunk[] }> {
  const chapters: Array<{ title: string; chunks: ReadingChunk[] }> = [];
  let current: { title: string; chunks: ReadingChunk[] } | null = null;

  for (const chunk of doc.chunks) {
    if (chunk.type === 'heading' && (chunk.level ?? 1) === 1) {
      if (current && current.chunks.length > 0) {
        chapters.push(current);
      }
      current = { title: chunk.text, chunks: [chunk] };
    } else {
      if (!current) {
        current = { title: 'Inicio', chunks: [] };
      }
      current.chunks.push(chunk);
    }
  }
  if (current && current.chunks.length > 0) {
    chapters.push(current);
  }
  return chapters;
}

export function encodeEditorialChapters(
  doc: BookReadingDocument,
  cek: Buffer,
  baseIv: Buffer = randomBytes(IGB1_NONCE_BYTES),
): ChapterChunkedIgb1Envelope {
  if (cek.byteLength !== IGB1_KEY_BYTES) {
    throw new Error(`CEK must be ${IGB1_KEY_BYTES} bytes`);
  }
  const chapters = splitDocumentIntoChapters(doc);
  const packets: EncryptedChapterPacket[] = chapters.map((ch, idx) => {
    const iv = deriveChapterIv(baseIv, idx);
    const compressed = gzipSync(Buffer.from(JSON.stringify(ch.chunks), 'utf8'), { level: 9 });
    const cipher = createCipheriv('aes-256-gcm', cek, iv);
    cipher.setAAD(buildChapterAad(doc.bookId, idx));
    const ct = Buffer.concat([cipher.update(compressed), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      chapterIndex: idx,
      title: ch.title,
      ivBase64: iv.toString('base64'),
      ciphertextBase64: Buffer.concat([ct, tag]).toString('base64'),
    };
  });

  return {
    magic: 'IGB1-CH',
    version: IGB1_VERSION,
    bookId: doc.bookId,
    tier: 'editorial_closed',
    chapters: packets,
  };
}

export function decodeEditorialChapter(
  bookId: string,
  packet: EncryptedChapterPacket,
  cek: Buffer,
): ReadingChunk[] {
  if (cek.byteLength !== IGB1_KEY_BYTES) {
    throw new Error(`CEK must be ${IGB1_KEY_BYTES} bytes`);
  }
  const iv = Buffer.from(packet.ivBase64, 'base64');
  const raw = Buffer.from(packet.ciphertextBase64, 'base64');
  if (raw.byteLength < IGB1_GCM_TAG_BYTES) {
    throw new Error('Invalid chapter packet: missing GCM tag');
  }
  const ct = raw.subarray(0, raw.byteLength - IGB1_GCM_TAG_BYTES);
  const tag = raw.subarray(raw.byteLength - IGB1_GCM_TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', cek, iv);
  decipher.setAAD(buildChapterAad(bookId, packet.chapterIndex));
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(gunzipSync(compressed).toString('utf8')) as ReadingChunk[];
}
