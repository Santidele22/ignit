import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { DevAccount } from './dev-account.entity.js';
import type { DevUser } from './dev-auth.service.js';
import { hashDevPassword, verifyDevPassword } from './dev-password.js';

const DUPLICATE_EMAIL_MESSAGE = 'Ya existe una cuenta registrada con ese correo.';

/**
 * Persists local test accounts in SQLite (`dev_account` + `user`) so
 * `AUTH_MODE=dev` can exercise multi-user libraries and progress without
 * Better Auth or Neon.
 */
@Injectable()
export class DevAccountsService {
  constructor(
    @InjectRepository(DevAccount)
    private readonly accountsRepository: Repository<DevAccount>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async register(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<DevUser> {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    if (!name) {
      throw new BadRequestException('El nombre es obligatorio.');
    }

    const [existingAccount, existingUser] = await Promise.all([
      this.accountsRepository.findOne({ where: { email } }),
      this.usersRepository.findOne({ where: { email } }),
    ]);
    if (existingAccount || existingUser) {
      throw new ConflictException(DUPLICATE_EMAIL_MESSAGE);
    }

    const id = randomUUID();
    const passwordHash = await hashDevPassword(input.password);

    try {
      await this.usersRepository.manager.transaction(async (manager) => {
        const userRepo = manager.getRepository(User);
        const accountRepo = manager.getRepository(DevAccount);

        await userRepo.save(
          userRepo.create({
            id,
            name,
            email,
            emailVerified: false,
            role: 'user',
          }),
        );

        await accountRepo.save(
          accountRepo.create({
            id,
            email,
            name,
            passwordHash,
          }),
        );
      });
    } catch (error) {
      const raced =
        (await this.accountsRepository.findOne({ where: { email } })) ??
        (await this.usersRepository.findOne({ where: { email } }));
      if (raced) {
        throw new ConflictException(DUPLICATE_EMAIL_MESSAGE);
      }
      throw error;
    }

    return { id, email, name, role: 'user' };
  }

  async verifyCredentials(
    email: string,
    password: string,
  ): Promise<DevUser | null> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      return null;
    }

    const account = await this.accountsRepository.findOne({
      where: { email: normalizedEmail },
    });
    if (!account) {
      return null;
    }

    const matches = await verifyDevPassword(password, account.passwordHash);
    if (!matches) {
      return null;
    }

    return {
      id: account.id,
      email: account.email,
      name: account.name,
      role: 'user',
    };
  }
}
