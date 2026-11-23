/**
 * Auth stack the API mounts. `dev` is the interim hardcoded local account,
 * `better` is the self-hosted Better Auth default, and `neon` verifies managed
 * Neon Auth JWTs in production.
 */
export type AuthMode = 'dev' | 'better' | 'neon';

/** Only the `warn` method is used, so tests can pass a fake. */
export type AuthModeLogger = { warn: (message: string) => void };
