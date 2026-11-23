/**
 * Validation of the managed Neon Auth URLs. Pure and read while modules are
 * imported: it only inspects the env it is given, plus the `AUTH_MODE` matrix.
 */
import { resolveAuthMode } from './resolve-auth-mode.js';

export function neonAuthConfigError(env: NodeJS.ProcessEnv): string | null {
  if (resolveAuthMode(env) !== 'neon') {
    return null;
  }

  for (const key of ['NEON_AUTH_BASE_URL', 'NEON_AUTH_JWKS_URL'] as const) {
    try {
      const url = new URL(env[key] ?? '');
      if (url.protocol !== 'https:') {
        throw new Error('https required');
      }
    } catch {
      return `[auth] AUTH_MODE=neon requires a valid HTTPS ${key}.`;
    }
  }

  return null;
}
