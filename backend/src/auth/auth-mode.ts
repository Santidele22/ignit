/**
 * Auth stack the API mounts: `dev` is the interim hardcoded local account,
 * `better` is the self-hosted Better Auth default, and `neon` verifies managed
 * Neon Auth JWTs in production.
 *
 * The decisions themselves live in `./mode/`: `resolve-auth-mode.ts` for the
 * `AUTH_MODE`/`DB_MODE` matrix, `dev-credentials.ts` for the dev checks,
 * `neon-auth-config.ts` for the managed URL validation and `no-auth-policy.ts`
 * for the fail-closed boot. This module stays the import path its consumers
 * use and re-exports every decision unchanged.
 *
 * Everything here is read while modules are imported, exactly like
 * `isAuthEnabled`, so it must stay side effect free: the only thing the
 * decision does is warn about an incomplete dev configuration.
 */
import { postgresBacked } from '../config/db-mode.js';
import type { AuthMode, AuthModeLogger } from './mode/auth-mode-types.js';
import { neonAuthConfigError } from './mode/neon-auth-config.js';
import { isNoAuthAllowed, noAuthStartupError } from './mode/no-auth-policy.js';
import { resolveAuthMode } from './mode/resolve-auth-mode.js';

export type { AuthMode, AuthModeLogger };
export {
  isNoAuthAllowed,
  neonAuthConfigError,
  noAuthStartupError,
  resolveAuthMode,
};

/** Auth stack the app is running, decided once when the modules load. */
export const authMode: AuthMode = resolveAuthMode(process.env);

/**
 * Single source of truth for whether the Better Auth stack is mounted, derived
 * from the same `authMode` decision above: `main.ts` (the `NestFactory` body
 * parser option) and `auth.module.ts` (the module mounting) must never compute
 * it separately, or the conditions can silently diverge. Better Auth also
 * needs the PostgreSQL store (`postgresBacked`): an explicit `DB_MODE=dev`
 * keeps it off even when `DATABASE_URL` is set.
 */
export const betterAuthMounted = authMode === 'better' && postgresBacked;

export const devAuthMounted = authMode === 'dev';
export const neonAuthMounted =
  authMode === 'neon' && postgresBacked && !neonAuthConfigError(process.env);

/**
 * Whether a guard stack is actually mounted. This is the fact that matters
 * for security: when it is `false` no `APP_GUARD` runs and every mutation is
 * open, so the app must not boot unless the owner explicitly opted out with
 * `ALLOW_NO_AUTH=true` (documented for tests and Docker-less local dev only).
 */
export const authStackMounted = betterAuthMounted || devAuthMounted || neonAuthMounted;

/**
 * Whether Nest's default body parser stays on for the whole app. Better Auth
 * reads the raw request body, so the parser is only disabled while that stack
 * is mounted; it re-adds parsers for every route outside `/api/auth`. The
 * interim dev auth module and the no-auth fallback are plain JSON controllers
 * and need the default parser on.
 */
export const bodyParserEnabled = !betterAuthMounted;
