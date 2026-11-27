import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import type { Book } from '../books/entities/book.entity.js';
import {
  decodeEditorialChapter,
  encodeEditorialChapters,
} from '../books/igb/igb1.chapters.js';
import type { BookReadingDocument } from '../books/reading/reading.types.js';
import { BooksService } from '../books/books.service.js';
import type { BookStorage } from '../books/storage/book-storage.js';
import { DevicesService } from '../devices/devices.service.js';
import type { Device } from '../devices/entities/device.entity.js';
import type { BookEntitlement, License } from './entities/license.entity.js';
import { deriveEditorialCek, LicensesService } from './licenses.service.js';

describe('Kindle-style Editorial DRM (devices, CEK wrapping, chapter decryption, 403 block)', () => {
  it('enforces max 5 active devices per user and allows registration after revocation', async () => {
    const devices: Device[] = [];
    let seq = 1;
    const repo = {
      find: vi.fn(async ({ where }: { where: { userId: string } }) =>
        devices.filter((d) => d.userId === where.userId),
      ),
      findOne: vi.fn(async ({ where }: { where: { id: string } }) =>
        devices.find((d) => d.id === where.id) ?? null,
      ),
      create: vi.fn((p: Partial<Device>) => ({ ...p, id: `dev-${seq++}` }) as Device),
      save: vi.fn(async (d: Device) => {
        const idx = devices.findIndex((x) => x.id === d.id);
        if (idx >= 0) devices[idx] = d;
        else devices.push(d);
        return d;
      }),
    } as unknown as Repository<Device>;

    const service = new DevicesService(repo);
    for (let i = 1; i <= 5; i++) {
      const { publicKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      await service.register('u-1', {
        platform: 'android',
        name: `Device ${i}`,
        publicKeyPem: publicKey,
      });
    }

    const { publicKey: sixthKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    await expect(
      service.register('u-1', {
        platform: 'desktop_linux',
        name: 'Device 6',
        publicKeyPem: sixthKey,
      }),
    ).rejects.toMatchObject({ status: 403 });

    await service.revoke('u-1', 'dev-1');
    const dev6 = await service.register('u-1', {
      platform: 'desktop_linux',
      name: 'Device 6',
      publicKeyPem: sixthKey,
    });
    expect(dev6.name).toBe('Device 6');
  });

  it('wraps CEK exclusively for authorized device publicKey and decrypts individual chapters', async () => {
    const kpA = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const kpB = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const licenses: License[] = [];
    const deviceA: Device = {
      id: 'dev-a',
      userId: 'u-reader',
      platform: 'android',
      name: 'Pixel',
      publicKeyPem: kpA.publicKey,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      revokedAt: null,
    };
    const book: Book = {
      id: 700,
      ownerId: 'publisher-1',
      contentTier: 'editorial_closed',
    } as Book;
    const entitlements: BookEntitlement[] = [
      {
        id: 'ent-1',
        userId: 'u-reader',
        bookId: 700,
        grantedAt: new Date(),
        expiresAt: null,
        revokedAt: null,
      },
    ];

    const licensesService = new LicensesService(
      {
        findOne: vi.fn(async () => null),
        create: vi.fn((p: Partial<License>) => ({ ...p, id: 'lic-1' }) as License),
        save: vi.fn(async (l: License) => {
          licenses.push(l);
          return l;
        }),
        find: vi.fn(async () => licenses),
      } as unknown as Repository<License>,
      {
        findOne: vi.fn(async ({ where }: { where: { userId: string; bookId: number } }) =>
          entitlements.find((e) => e.userId === where.userId && e.bookId === where.bookId) ?? null,
        ),
      } as unknown as Repository<BookEntitlement>,
      {
        findOne: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === 'dev-a' ? deviceA : null,
        ),
      } as unknown as Repository<Device>,
      {
        findOne: vi.fn(async ({ where }: { where: { id: number } }) =>
          where.id === 700 ? book : null,
        ),
      } as unknown as Repository<Book>,
    );

    const license = await licensesService.acquire('u-reader', 700, 'dev-a');

    // Device A unwraps CEK successfully
    const unwrappedCek = privateDecrypt(
      {
        key: kpA.privateKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(license.wrappedCek, 'base64'),
    );
    expect(unwrappedCek.equals(deriveEditorialCek(700))).toBe(true);

    // Device B CANNOT unwrap Device A's wrapped CEK
    expect(() =>
      privateDecrypt(
        {
          key: kpB.privateKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        Buffer.from(license.wrappedCek, 'base64'),
      ),
    ).toThrow();

    // Unentitled user is rejected
    await expect(licensesService.acquire('u-pirate', 700, 'dev-a')).rejects.toMatchObject({
      status: 403,
    });

    // Chapter-by-chapter encryption & decryption using the unwrapped CEK
    const doc: BookReadingDocument = {
      bookId: '700',
      pdfPages: 4,
      ocrPending: false,
      chunks: [
        { id: 'c1', type: 'heading', level: 1, page: 1, offset: 0, text: 'Cap 1', mood: 'espera', cues: [] },
        { id: 'c2', type: 'para', page: 1, offset: 10, text: 'Texto secreto 1', mood: 'espera', cues: [] },
        { id: 'c3', type: 'heading', level: 1, page: 3, offset: 50, text: 'Cap 2', mood: 'espera', cues: [] },
        { id: 'c4', type: 'para', page: 3, offset: 60, text: 'Texto secreto 2', mood: 'espera', cues: [] },
      ],
    };

    const envelope = encodeEditorialChapters(doc, unwrappedCek);
    expect(envelope.chapters).toHaveLength(2);
    const ch2 = decodeEditorialChapter('700', envelope.chapters[1], unwrappedCek);
    expect(ch2.map((c) => c.text)).toEqual(['Cap 2', 'Texto secreto 2']);
  });

  it('blocks direct file download (403) for Tier 2 and Tier 3 even for admin', async () => {
    const booksService = new BooksService(
      {
        findOne: vi.fn(async () => ({
          id: 700,
          contentTier: 'editorial_closed',
          filePath: 'books/editorial/700.igb',
        })),
      } as unknown as Repository<Book>,
      {} as Repository<never>,
      {} as Repository<never>,
      {} as BookStorage,
    );

    await expect(
      booksService.prepareDownload(700, '127.0.0.1', { id: 'admin-1', role: 'admin' }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
