import type { BookReadingDocument } from '../reading/reading.types.js';
import { encodeIgb1 } from './igb1.codec.js';
import type { ContentTier, Igb1Compression } from './igb1.types.js';

export interface GoldenVectorEntry {
  name: string;
  bookId: string;
  tier: ContentTier;
  compression: Igb1Compression;
  encrypted: boolean;
  keyHex?: string;
  ivHex?: string;
  aadUtf8: string;
  igb1Base64: string;
  expectedDocument: BookReadingDocument;
}

export interface Igb1GoldenVectorsFile {
  spec: {
    magic: string;
    version: number;
    headerBytes: number;
    nonceBytes: number;
    gcmTagBytes: number;
    aadFormat: string;
    flags: {
      bit0_brotli: number;
      bit1_encrypted: number;
      bit2_chunked: number;
    };
  };
  vectors: GoldenVectorEntry[];
}

const SAMPLE_DOC_PUBLIC: BookReadingDocument = {
  bookId: '101',
  pdfPages: 2,
  ocrPending: false,
  extractorVersion: 3,
  chunks: [
    {
      id: 'c-0',
      type: 'heading',
      page: 1,
      offset: 0,
      text: 'Prólogo',
      mood: 'espera',
      cues: [],
      level: 1,
      align: 'center',
    },
    {
      id: 'c-1',
      type: 'para',
      page: 1,
      offset: 24,
      text: 'En un lugar de la Mancha, de cuyo nombre no quiero acordarme.',
      mood: 'espera',
      cues: [],
      align: 'left',
    },
  ],
};

const SAMPLE_DOC_PRIVATE: BookReadingDocument = {
  bookId: '202',
  pdfPages: 3,
  ocrPending: false,
  extractorVersion: 3,
  refinedByAi: true,
  chunks: [
    {
      id: 'c-0',
      type: 'dialogue',
      page: 1,
      offset: 0,
      text: '—¿Quién anda ahí? —dijo en voz baja.',
      mood: 'alerta',
      cues: ['voz'],
      align: 'left',
    },
  ],
};

const SAMPLE_DOC_EDITORIAL: BookReadingDocument = {
  bookId: '303',
  pdfPages: 5,
  ocrPending: false,
  extractorVersion: 3,
  chunks: [
    {
      id: 'c-0',
      type: 'quote',
      page: 2,
      offset: 100,
      text: 'El conocimiento es poder.',
      mood: 'polvo',
      cues: [],
      align: 'right',
    },
  ],
};

export function buildGoldenVectors(): Igb1GoldenVectorsFile {
  const key202Hex = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
  const iv202Hex = 'a0a1a2a3a4a5a6a7a8a9aaab';

  const key303Hex = 'ffeeddccbbaa9988776655443322110000112233445566778899aabbccddeeff';
  const iv303Hex = '102030405060708090a0b0c0';

  const v1 = encodeIgb1(SAMPLE_DOC_PUBLIC, {
    bookId: '101',
    tier: 'public_open',
    compression: 'gzip',
  });

  const v2 = encodeIgb1(SAMPLE_DOC_PUBLIC, {
    bookId: '101',
    tier: 'public_open',
    compression: 'brotli',
  });

  const v3 = encodeIgb1(SAMPLE_DOC_PRIVATE, {
    bookId: '202',
    tier: 'private_user',
    compression: 'gzip',
    key: Buffer.from(key202Hex, 'hex'),
    iv: Buffer.from(iv202Hex, 'hex'),
  });

  const v4 = encodeIgb1(SAMPLE_DOC_EDITORIAL, {
    bookId: '303',
    tier: 'editorial_closed',
    compression: 'gzip',
    key: Buffer.from(key303Hex, 'hex'),
    iv: Buffer.from(iv303Hex, 'hex'),
  });

  return {
    spec: {
      magic: 'IGB1',
      version: 1,
      headerBytes: 18,
      nonceBytes: 12,
      gcmTagBytes: 16,
      aadFormat: '${bookId}|${version}|${tier}',
      flags: {
        bit0_brotli: 1,
        bit1_encrypted: 2,
        bit2_chunked: 4,
      },
    },
    vectors: [
      {
        name: 'tier1_public_gzip',
        bookId: '101',
        tier: 'public_open',
        compression: 'gzip',
        encrypted: false,
        aadUtf8: '101|1|public_open',
        igb1Base64: v1.toString('base64'),
        expectedDocument: SAMPLE_DOC_PUBLIC,
      },
      {
        name: 'tier1_public_brotli',
        bookId: '101',
        tier: 'public_open',
        compression: 'brotli',
        encrypted: false,
        aadUtf8: '101|1|public_open',
        igb1Base64: v2.toString('base64'),
        expectedDocument: SAMPLE_DOC_PUBLIC,
      },
      {
        name: 'tier2_private_gzip_aes256gcm',
        bookId: '202',
        tier: 'private_user',
        compression: 'gzip',
        encrypted: true,
        keyHex: key202Hex,
        ivHex: iv202Hex,
        aadUtf8: '202|1|private_user',
        igb1Base64: v3.toString('base64'),
        expectedDocument: SAMPLE_DOC_PRIVATE,
      },
      {
        name: 'tier3_editorial_gzip_aes256gcm',
        bookId: '303',
        tier: 'editorial_closed',
        compression: 'gzip',
        encrypted: true,
        keyHex: key303Hex,
        ivHex: iv303Hex,
        aadUtf8: '303|1|editorial_closed',
        igb1Base64: v4.toString('base64'),
        expectedDocument: SAMPLE_DOC_EDITORIAL,
      },
    ],
  };
}
