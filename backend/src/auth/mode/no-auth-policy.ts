/**
 * Fail-closed boot policy for the case where no guard stack is mounted. Kept
 * pure (like `resolveAuthMode`) so it is unit-testable and safe while modules
 * are imported: `auth.module.ts` throws with the returned message.
 */

/**
 * Explicit opt-in for running with no auth stack mounted. Anything other than
 * the exact string `true` keeps the boot fail-closed.
 */
export function isNoAuthAllowed(env: NodeJS.ProcessEnv): boolean {
  return env.ALLOW_NO_AUTH === 'true';
}

/**
 * Error message that aborts the boot when no auth stack is mounted and the
 * owner did not opt out, or `null` when the startup is legal.
 */
export function noAuthStartupError(
  env: NodeJS.ProcessEnv,
  mounted: boolean,
): string | null {
  if (mounted || isNoAuthAllowed(env)) {
    return null;
  }

  return (
    '[auth] Refusing to boot without an auth stack: no DATABASE_URL ' +
    '(Better Auth) and no AUTH_MODE=dev credentials, so no guard would run ' +
    'and every mutation would be open. Set DATABASE_URL, or AUTH_MODE=dev ' +
    'with ADMIN_EMAIL, ADMIN_PASSWORD and DEV_SESSION_SECRET, or explicitly ' +
    'opt out with ALLOW_NO_AUTH=true (tests and Docker-less local dev only).'
  );
}
