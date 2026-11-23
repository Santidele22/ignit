import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import { admin } from 'better-auth/plugins/admin';
import { Pool } from 'pg';

const DEFAULT_TRUSTED_ORIGINS = ['http://localhost:4321', 'http://localhost:3987'];

function trustedOrigins(): string[] {
  const configured = (
    process.env.BETTER_AUTH_TRUSTED_ORIGINS ??
    process.env.CORS_ORIGINS ??
    ''
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return configured.length > 0 ? configured : DEFAULT_TRUSTED_ORIGINS;
}

function crossSiteCookies(): boolean {
  return process.env.BETTER_AUTH_CROSS_SITE === 'true';
}

function createAuthDatabase(): Pool {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool.on('error', (err) => {
    console.error('[auth] PostgreSQL pool error:', err.message);
  });
  return pool;
}

export function authOptions(): BetterAuthOptions {
  return {
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: trustedOrigins(),
    database: createAuthDatabase(),
    emailAndPassword: {
      enabled: true,
      // Multi-user Ignit: public email/password sign-up is open so any reader
      // can register, upload their own PDFs, and sync their reading progress.
      disableSignUp: false,
    },
    rateLimit: {
      enabled: process.env.BETTER_AUTH_RATE_LIMIT !== 'false',
      storage: 'memory',
    },
    ...(crossSiteCookies()
      ? {
          advanced: {
            defaultCookieAttributes: { sameSite: 'none' as const, secure: true },
          },
        }
      : {}),
    plugins: [admin()],
  };
}

/**
 * Builds the Better Auth instance on demand so SQLite local dev and unit
 * tests never open a PostgreSQL pool.
 */
export function createAuth() {
  return betterAuth(authOptions());
}
