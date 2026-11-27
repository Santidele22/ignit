import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { constants, createHmac, hkdfSync, publicEncrypt } from 'node:crypto';
import type { Repository } from 'typeorm';
import { Book } from '../books/entities/book.entity.js';
import { IGB1_KEY_BYTES } from '../books/igb/igb1.types.js';
import { Device } from '../devices/entities/device.entity.js';
import { BookEntitlement, License } from './entities/license.entity.js';

const DEFAULT_EDITORIAL_KEK = 'ignit-dev-editorial-kek-32-bytes!';
const DEFAULT_LICENSE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function deriveEditorialCek(
  bookId: number,
  env: NodeJS.ProcessEnv = process.env,
): Buffer {
  const kek = env.IGB_EDITORIAL_KEK ?? env.IGB_MASTER_KEY ?? DEFAULT_EDITORIAL_KEK;
  const raw = hkdfSync(
    'sha256',
    Buffer.from(kek, 'utf8'),
    Buffer.from('ignit:editorial_closed:cek', 'utf8'),
    Buffer.from(`book:${bookId}`, 'utf8'),
    IGB1_KEY_BYTES,
  );
  return Buffer.from(raw);
}

export function wrapCekForDevice(cek: Buffer, publicKeyPem: string): string {
  const encrypted = publicEncrypt(
    {
      key: publicKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    cek,
  );
  return encrypted.toString('base64');
}

export function signLicensePayload(
  payload: {
    userId: string;
    bookId: number;
    deviceId: string;
    expiresAtMs: number | null;
  },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = env.BETTER_AUTH_SECRET ?? DEFAULT_EDITORIAL_KEK;
  const data = `${payload.userId}|${payload.bookId}|${payload.deviceId}|${payload.expiresAtMs ?? 'none'}`;
  return createHmac('sha256', secret).update(data, 'utf8').digest('hex');
}

@Injectable()
export class LicensesService {
  constructor(
    @InjectRepository(License)
    private readonly licensesRepository: Repository<License>,
    @InjectRepository(BookEntitlement)
    private readonly entitlementsRepository: Repository<BookEntitlement>,
    @InjectRepository(Device)
    private readonly devicesRepository: Repository<Device>,
    @InjectRepository(Book)
    private readonly booksRepository: Repository<Book>,
  ) {}

  async acquire(userId: string, bookId: number, deviceId: string): Promise<License> {
    const device = await this.devicesRepository.findOne({ where: { id: deviceId } });
    if (!device || device.userId !== userId || device.revokedAt) {
      throw new ForbiddenException('Dispositivo no autorizado o revocado.');
    }

    const book = await this.booksRepository.findOne({ where: { id: bookId } });
    if (!book) {
      throw new NotFoundException('Libro no encontrado.');
    }

    const isOwner = book.ownerId === userId;
    if (!isOwner && book.contentTier === 'editorial_closed') {
      const ent = await this.entitlementsRepository.findOne({ where: { userId, bookId } });
      const now = Date.now();
      const valid =
        Boolean(ent) &&
        !ent!.revokedAt &&
        (!ent!.expiresAt || ent!.expiresAt.getTime() > now);
      if (!valid) {
        throw new ForbiddenException('No tenés una licencia activa para este libro editorial.');
      }
    }

    const cek = deriveEditorialCek(bookId);
    const wrappedCek = wrapCekForDevice(cek, device.publicKeyPem);
    const expiresAt = new Date(Date.now() + DEFAULT_LICENSE_TTL_MS);
    const signature = signLicensePayload({
      userId,
      bookId,
      deviceId,
      expiresAtMs: expiresAt.getTime(),
    });

    const existing = await this.licensesRepository.findOne({
      where: { userId, bookId, deviceId },
    });

    const entity = existing ?? this.licensesRepository.create({ userId, bookId, deviceId });
    entity.wrappedCek = wrappedCek;
    entity.expiresAt = expiresAt;
    entity.revokedAt = null;
    entity.signature = signature;
    return this.licensesRepository.save(entity);
  }

  async revokeForDevice(deviceId: string): Promise<void> {
    const rows = await this.licensesRepository.find({ where: { deviceId } });
    const now = new Date();
    for (const row of rows) {
      if (!row.revokedAt) {
        row.revokedAt = now;
        await this.licensesRepository.save(row);
      }
    }
  }

  async listForUser(userId: string): Promise<License[]> {
    return this.licensesRepository.find({ where: { userId } });
  }
}
