/**
 * `AUTH_MODE`/`DB_MODE` matrix deciding which auth stack the API mounts.
 *
 * The decision is read while modules are imported, exactly like
 * `isAuthEnabled`, so it must stay side effect free: the only thing it does is
 * warn about an incomplete configuration.
 */
import type { AuthMode, AuthModeLogger } from './auth-mode-types.js';
import { hasDevCredentials } from './dev-credentials.js';

/**
 * `AUTH_MODE=dev` needs both `ADMIN_EMAIL` and `ADMIN_PASSWORD`: without them
 * there is no account to sign in with, so the app warns and keeps Better Auth.
 *
 * Note that this only picks the auth stack. The data store is decided by
 * `DB_MODE` (`src/config/db-mode.ts`), so `AUTH_MODE=dev` works
 * with PostgreSQL and with the SQLite fallback unchanged.
 */
export function resolveAuthMode(
  env: NodeJS.ProcessEnv,
  logger: AuthModeLogger = console,
): AuthMode {
  if (env.AUTH_MODE === 'neon') {
    if (env.DB_MODE === 'prod') {
      return 'neon';
    }

    logger.warn('[auth] AUTH_MODE=neon requires DB_MODE=prod: falling back to Better Auth.');
    return 'better';
  }

  if (env.AUTH_MODE !== 'dev') {
    return 'better';
  }

  if (!hasDevCredentials(env)) {
    logger.warn(
      '[auth] AUTH_MODE=dev requires ADMIN_EMAIL, ADMIN_PASSWORD and ' +
        'DEV_SESSION_SECRET: falling back to Better Auth.',
    );
    return 'better';
  }

  return 'dev';
}
