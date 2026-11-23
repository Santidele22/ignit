import { registerAs } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import {
  type DbMode,
  dbMode,
  dbModeStartupError,
  postgresBacked,
} from './db-mode.js';

export const POSTGRES_POOL_EXTRA = {
  max: 10,
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 30_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
} as const;

export function buildDatabaseOptions(
  env: NodeJS.ProcessEnv,
  mode: DbMode,
  isPostgresBacked: boolean,
): TypeOrmModuleOptions {
  const startupError = dbModeStartupError(env, mode);
  if (startupError) {
    throw new Error(startupError);
  }

  if (isPostgresBacked) {
    // `prod` never synchronizes: schema changes go through explicit
    // migrations there. `dev-neon` (and the legacy `DATABASE_URL` path)
    // keep synchronize on so the branch can evolve freely.
    const synchronize =
      mode === 'prod' ? false : env.NODE_ENV !== 'production';
    const databaseUrl = env.DATABASE_URL as string;
    return {
      type: 'postgres',
      // Neon hands out two strings: pooled `DATABASE_URL` (PgBouncer in
      // transaction mode) for app traffic and direct
      // `DATABASE_URL_UNPOOLED` for schema work. `synchronize` is DDL, so
      // while it is on the pool must use the direct connection — session
      // state does not survive the pooler.
      url: synchronize
        ? (env.DATABASE_URL_UNPOOLED ?? databaseUrl)
        : databaseUrl,
      autoLoadEntities: true,
      synchronize,
      extra: { ...POSTGRES_POOL_EXTRA },
    };
  }

  return {
    type: 'better-sqlite3',
    database:
      env.NODE_ENV === 'test'
        ? ':memory:'
        : (env.SQLITE_DATABASE ?? 'database.sqlite'),
    autoLoadEntities: true,
    synchronize:
      env.DB_SYNCHRONIZE !== undefined
        ? env.DB_SYNCHRONIZE === 'true'
        : env.NODE_ENV !== 'production',
  };
}

export const databaseConfig = registerAs(
  'database',
  (): TypeOrmModuleOptions =>
    buildDatabaseOptions(process.env, dbMode, postgresBacked),
);
