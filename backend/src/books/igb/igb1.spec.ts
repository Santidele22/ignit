import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BookReadingDocument } from '../reading/reading.types.js';
import { compactReadingDocument, expandReadingDocument } from './igb1.compactor.js';
import { decodeIgb1, encodeIgb1, parseIgb1Header } from './igb1.codec.js';
import type { Igb1GoldenVectorsFile } from './igb1.golden-vectors.js';
import { IGB1_FLAG_BROTLI, IGB1_FLAG_ENCRYPTED, IGB1_MAGIC, IGB1_VERSION } from './igb1.types.js';

function makeSampleDocument(chunkCount = 120): BookReadingDocument {
  const chunks = Array.from({ length: chunkCount }, (_, idx) => {
    if (idx === 0) {
      return {
        id: `c-${idx}`,
        type: 'heading' as const,
        page: 1,
        offset: 0,
        text: 'Capítulo I — El comienzo',
        mood: 'espera' as const,
        cues: [],
        level: 1 as const,
        align: 'center' as const,
      };
    }
    if (idx % 15 === 0) {
      return {
        id: `c-${idx}`,
        type: 'dialogue' as const,
        page: Math.floor(idx / 8) + 1,
        offset: idx * 140,
        text: `—¿Escuchaste eso? —preguntó Elena mirando hacia el pasillo oscuro número ${idx}.`,
        mood: 'alerta' as const,
        cues: ['voz'],
        align: 'left' as const,
      };
    }
    return {
      id: `c-${idx}`,
      type: 'para' as const,
      page: Math.floor(idx / 8) + 1,
      offset: idx * 140,
      text: `Este es el párrafo de prueba número ${idx} diseñado para verificar la compactación y compresión del formato IGB1 en Ignit sin perder fidelidad semántica.`,
      mood: 'espera' as const,
      cues: [],
      align: 'left' as const,
    };
  });

  return {
    bookId: '42',
    pdfPages: 18,
    ocrPending: false,
    extractorVersion: 3,
    refinedByAi: true,
    aiRefinement: {
      applied: true,
      model: 'gemini-test',
      passes: 2,
      reclassified: 4,
      merged: 2,
      dropped: 3,
      clutter: [
        {
          id: 'cl-1',
          page: 1,
          text: 'Página 1 de 18',
          reason: 'running header',
          action: 'dropped',
        },
      ],
    },
    chunks,
  };
}

describe('IGB1 compactor', () => {
  it('omits defaults and aiRefinement.clutter, and round-trips faithfully', () => {
    const doc = makeSampleDocument(5);
    const compact = compactReadingDocument(doc);

    expect(compact.v).toBe(1);
    expect(compact.b).toBe('42');
    expect(compact.p).toBe(18);
    expect(compact.o).toBeUndefined();
    expect(compact.ai).toBe(1);
    expect((compact as unknown as Record<string, unknown>).aiRefinement).toBeUndefined();

    // Paragraph chunk omits default type='para', mood='espera', cues=[], align='left'
    const paraChunk = compact.c[1];
    expect(paraChunk.t).toBeUndefined();
    expect(paraChunk.m).toBeUndefined();
    expect(paraChunk.q).toBeUndefined();
    expect(paraChunk.a).toBeUndefined();

    const expanded = expandReadingDocument(compact);
    expect(expanded.bookId).toBe(doc.bookId);
    expect(expanded.pdfPages).toBe(doc.pdfPages);
    expect(expanded.ocrPending).toBe(false);
    expect(expanded.extractorVersion).toBe(3);
    expect(expanded.refinedByAi).toBe(true);
    expect(expanded.chunks).toHaveLength(doc.chunks.length);
    expect(expanded.chunks[0]).toMatchObject({
      id: 'c-0',
      type: 'heading',
      level: 1,
      align: 'center',
      mood: 'espera',
      cues: [],
    });
    expect(expanded.chunks[1]).toMatchObject({
      id: 'c-1',
      type: 'para',
      mood: 'espera',
      cues: [],
      align: 'left',
      text: doc.chunks[1].text,
    });
  });
});

describe('IGB1 binary codec', () => {
  it('encodes and decodes Tier 1 plaintext with gzip and brotli, reducing size by >80%', () => {
    const doc = makeSampleDocument(200);
    const rawJsonBytes = Buffer.byteLength(JSON.stringify(doc), 'utf8');

    for (const compression of ['gzip', 'brotli'] as const) {
      const encoded = encodeIgb1(doc, {
        bookId: '42',
        tier: 'public_open',
        compression,
      });

      const header = parseIgb1Header(encoded);
      expect(header.magic).toBe(IGB1_MAGIC);
      expect(header.version).toBe(IGB1_VERSION);
      expect(Boolean(header.flags & IGB1_FLAG_ENCRYPTED)).toBe(false);
      expect(Boolean(header.flags & IGB1_FLAG_BROTLI)).toBe(compression === 'brotli');

      const reduction = 1 - encoded.byteLength / rawJsonBytes;
      expect(reduction).toBeGreaterThan(0.8);

      const decoded = decodeIgb1(encoded, { bookId: '42', tier: 'public_open' });
      expect(decoded.chunks).toHaveLength(200);
      expect(decoded.chunks[15].type).toBe('dialogue');
    }
  });

  it('encodes and decodes Tier 2/3 with AES-256-GCM and AAD', () => {
    const doc = makeSampleDocument(30);
    const key = randomBytes(32);
    const iv = randomBytes(12);

    const encoded = encodeIgb1(doc, {
      bookId: '42',
      tier: 'private_user',
      compression: 'gzip',
      key,
      iv,
    });

    const header = parseIgb1Header(encoded);
    expect(Boolean(header.flags & IGB1_FLAG_ENCRYPTED)).toBe(true);
    expect(header.nonce.equals(iv)).toBe(true);

    const decoded = decodeIgb1(encoded, {
      bookId: '42',
      tier: 'private_user',
      key,
    });
    expect(decoded.bookId).toBe('42');
    expect(decoded.chunks).toHaveLength(30);
  });

  it('rejects tampered AAD (wrong bookId or tier), tampered tag, or invalid magic', () => {
    const doc = makeSampleDocument(10);
    const key = randomBytes(32);
    const iv = randomBytes(12);

    const encoded = encodeIgb1(doc, {
      bookId: '42',
      tier: 'editorial_closed',
      compression: 'gzip',
      key,
      iv,
    });

    expect(() =>
      decodeIgb1(encoded, { bookId: '99', tier: 'editorial_closed', key }),
    ).toThrow();

    expect(() =>
      decodeIgb1(encoded, { bookId: '42', tier: 'private_user', key }),
    ).toThrow();

    const tamperedTag = Buffer.from(encoded);
    tamperedTag[tamperedTag.length - 1] ^= 0xff;
    expect(() =>
      decodeIgb1(tamperedTag, { bookId: '42', tier: 'editorial_closed', key }),
    ).toThrow();

    const badMagic = Buffer.from(encoded);
    badMagic[0] = 0x58; // 'X'
    expect(() =>
      decodeIgb1(badMagic, { bookId: '42', tier: 'editorial_closed', key }),
    ).toThrow();
  });

  it('matches docs/specs/igb1-golden-vectors.json byte-for-byte', () => {
    const vectorsPath = resolve(process.cwd(), '../docs/specs/igb1-golden-vectors.json');
    const raw = readFileSync(vectorsPath, 'utf8');
    const file = JSON.parse(raw) as Igb1GoldenVectorsFile;

    expect(file.vectors.length).toBeGreaterThanOrEqual(4);
    for (const vec of file.vectors) {
      const buf = Buffer.from(vec.igb1Base64, 'base64');
      const key = vec.keyHex ? Buffer.from(vec.keyHex, 'hex') : undefined;
      const decoded = decodeIgb1(buf, {
        bookId: vec.bookId,
        tier: vec.tier,
        key,
      });
      expect(decoded).toEqual(vec.expectedDocument);
    }
  });
});
