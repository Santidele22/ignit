/**
 * Data store the API talks to, chosen explicitly with `DB_MODE`:
 *
 * - `dev` (default): local development. TypeORM uses the SQLite file and the
 *   Better Auth stack stays unmounted, **even when `DATABASE_URL` is set** —
 *   the flag is authoritative so a leftover `DATABASE_URL` in `.env` cannot
 *   silently move the app onto an empty PostgreSQL.
 * - `dev-neon`: a Neon development branch over `DATABASE_URL`, schema
 *   `synchronize` on so the branch can evolve freely.
 * - `prod`: the Neon production branch over `DATABASE_URL`, `synchronize`
 *   always off; booting without `DATABASE_URL` fails closed.
 *
 * When `DB_MODE` is not set at all the app keeps the legacy behaviour
 * (`DATABASE_URL` present selects PostgreSQL, otherwise SQLite) so existing
 * test and docker workflows keep working unchanged.
 *
 * The decision is read while modules are imported (entities pick their column
 * types from it), exactly like `authMode`, so it must stay side effect free:
 * the only thing `resolveDbMode` does is warn about a missing `DATABASE_URL`.
 */
export type DbMode = 'dev' | 'dev-neon' | 'prod';

/** Only the `warn` method is used, so tests can pass a fake. */
export type DbModeLogger = { warn: (message: string) => void };

export function resolveDbMode(
  env: NodeJS.ProcessEnv,
  logger: DbModeLogger = console,
): DbMode {
  switch (env.DB_MODE) {
    case 'dev-neon':
      if (!env.DATABASE_URL) {
        logger.warn(
          '[db] DB_MODE=dev-neon requires DATABASE_URL: falling back to ' +
            'the local SQLite store.',
        );
        return 'dev';
      }
      return 'dev-neon';
    case 'prod':
      // No fallback here: booting production against the local SQLite file
      // would silently serve an empty store. `dbModeStartupError` aborts the
      // boot instead when DATABASE_URL is missing.
      return env.DATABASE_URL ? 'prod' : 'dev';
    default:
      return 'dev';
  }
}

/** Data store the app is running, decided once when the modules load. */
export const dbMode: DbMode = resolveDbMode(process.env);

/**
 * Single source of truth for whether TypeORM and the auth stack talk to
 * PostgreSQL: `databaseConfig`, `isAuthEnabled`, `betterAuthMounted` and the
 * entity column types must never compute it separately, or the conditions can
 * silently diverge (content in one store, identity in another).
 *
 * Explicit `DB_MODE=dev` forces the SQLite store even with `DATABASE_URL`
 * set; an unset `DB_MODE` keeps the legacy `DATABASE_URL`-driven behaviour.
 */
export const postgresBacked =
  dbMode !== 'dev' ||
  (process.env.DB_MODE === undefined && Boolean(process.env.DATABASE_URL));

/**
 * Error message that aborts the boot when `prod` was resolved without a
 * usable `DATABASE_URL`, or `null` when the startup is legal. `resolveDbMode`
 * already falls back to `dev` in that case, so this only fires when the
 * fallback itself is unacceptable — kept pure (like `resolveDbMode`) so the
 * policy is unit-testable; `databaseConfig` throws with the returned message
 * when the config loads.
 */
export function dbModeStartupError(
  env: NodeJS.ProcessEnv,
  mode: DbMode,
): string | null {
  if (env.DB_MODE === 'prod' && mode !== 'prod') {
    return (
      '[db] Refusing to boot DB_MODE=prod without DATABASE_URL: the local ' +
        'SQLite fallback would silently serve an empty store in production. ' +
        'Set DATABASE_URL to the Neon production branch.'
    );
  }

  if (mode === 'dev') {
    return null;
  }

  for (const key of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED'] as const) {
    const value = env[key];
    if (value === undefined) {
      continue;
    }

    try {
      const url = new URL(value);
      if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
        throw new Error('unsupported protocol');
      }
    } catch {
      return (
        `[db] Invalid ${key}: expected an absolute postgres:// or ` +
        'postgresql:// connection URL. In Render, paste the complete Neon ' +
        'connection string, not a label such as "base".'
      );
    }
  }

  return null;
}
