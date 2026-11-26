import { Injectable, Optional } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { IncomingHttpHeaders } from 'node:http';
import { DataSource } from 'typeorm';
import type { RouteSession, SessionReader } from './session-reader.js';

const ROLE_CACHE_TTL_MS = 60_000;
const MAX_ROLE_CACHE_SIZE = 1_000;

@Injectable()
export class NeonSessionReader implements SessionReader {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;
  private readonly roleCache = new Map<string, { role: string; expiresAt: number }>();

  constructor(
    @Optional() private readonly dataSource: DataSource | undefined,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.jwks = createRemoteJWKSet(new URL(env.NEON_AUTH_JWKS_URL ?? ''));
    this.issuer = new URL(env.NEON_AUTH_BASE_URL ?? '').origin;
  }

  async read(headers: IncomingHttpHeaders): Promise<RouteSession | null> {
    const match = headers.authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return null;
    }

    try {
      const { payload } = await jwtVerify(match[1], this.jwks, {
        algorithms: ['EdDSA'],
        issuer: this.issuer,
        audience: this.issuer,
      });

      if (
        payload.banned === true ||
        typeof payload.sub !== 'string' ||
        typeof payload.email !== 'string'
      ) {
        return null;
      }

      const user: RouteSession['user'] = {
        id: payload.sub,
        email: payload.email,
        name: typeof payload.name === 'string' ? payload.name : payload.email,
        role: await this.findRole(
          payload.sub,
          typeof payload.role === 'string' ? payload.role : undefined,
        ),
      };

      return {
        user,
        session: {
          id: payload.sub,
          expiresAt: typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : undefined,
        },
      };
    } catch {
      return null;
    }
  }

  private async findRole(userId: string, tokenRole?: string): Promise<string> {
    if (!this.dataSource) {
      return tokenRole ?? 'authenticated';
    }

    const now = Date.now();
    const cached = this.roleCache.get(userId);
    if (cached && cached.expiresAt > now) {
      return cached.role;
    }

    const rows = await this.dataSource.query<Array<{ role: string | null }>>(
      'SELECT "role" FROM neon_auth."user" WHERE "id" = $1 LIMIT 1',
      [userId],
    );

    const role =
      typeof rows[0]?.role === 'string'
        ? rows[0].role
        : (tokenRole ?? 'authenticated');

    if (this.roleCache.size >= MAX_ROLE_CACHE_SIZE) {
      const oldestKey = this.roleCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.roleCache.delete(oldestKey);
      }
    }
    this.roleCache.set(userId, { role, expiresAt: now + ROLE_CACHE_TTL_MS });

    return role;
  }
}
