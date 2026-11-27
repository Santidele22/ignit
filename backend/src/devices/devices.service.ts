import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createPublicKey } from 'node:crypto';
import type { Repository } from 'typeorm';
import { Device, type DevicePlatform } from './entities/device.entity.js';

export const DEFAULT_MAX_DEVICES_PER_USER = 5;

export interface RegisterDeviceInput {
  platform: DevicePlatform;
  name: string;
  publicKeyPem: string;
}

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(Device)
    private readonly devicesRepository: Repository<Device>,
  ) {}

  maxDevicesLimit(): number {
    const raw = Number(process.env.MAX_DEVICES_PER_USER);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_DEVICES_PER_USER;
  }

  async register(userId: string, input: RegisterDeviceInput): Promise<Device> {
    if (!input.name?.trim()) {
      throw new BadRequestException('El nombre del dispositivo es obligatorio.');
    }
    try {
      createPublicKey(input.publicKeyPem);
    } catch {
      throw new BadRequestException('Clave pública PEM inválida.');
    }

    const existing = await this.devicesRepository.find({ where: { userId } });
    const active = existing.filter((d) => !d.revokedAt);
    const sameKey = active.find((d) => d.publicKeyPem === input.publicKeyPem);
    if (sameKey) {
      sameKey.lastSeenAt = new Date();
      sameKey.name = input.name.trim();
      return this.devicesRepository.save(sameKey);
    }

    const limit = this.maxDevicesLimit();
    if (active.length >= limit) {
      throw new ForbiddenException(
        `Alcanzaste el límite de ${limit} dispositivos activos. Revocá uno antes de registrar otro.`,
      );
    }

    const now = new Date();
    const device = this.devicesRepository.create({
      userId,
      platform: input.platform,
      name: input.name.trim(),
      publicKeyPem: input.publicKeyPem,
      lastSeenAt: now,
      revokedAt: null,
    });
    return this.devicesRepository.save(device);
  }

  async listForUser(userId: string): Promise<Device[]> {
    return this.devicesRepository.find({ where: { userId } });
  }

  async revoke(userId: string, deviceId: string): Promise<Device> {
    const device = await this.devicesRepository.findOne({ where: { id: deviceId } });
    if (!device || device.userId !== userId) {
      throw new NotFoundException('Dispositivo no encontrado.');
    }
    if (!device.revokedAt) {
      device.revokedAt = new Date();
      await this.devicesRepository.save(device);
    }
    return device;
  }
}
