/**
 * Shape of the signed dev session and the lifetime rules attached to it.
 *
 * The payload carries its own `exp`, so the default TTL, the `DEV_SESSION_TTL`
 * parsing and the expiry predicate live next to the shape they describe.
 */

export type DevRole = 'admin' | 'user';

/**
 * Content of the signed dev session cookie. Supports the `.env` administrator
 * (`role: 'admin'`) as well as locally registered multi-user test accounts
 * (`role: 'user'`).
 */
export type DevSessionPayload = {
  email: string;
  name?: string;
  role: DevRole;
  /** Stable id of the signed-in account (required for `role: 'user'`). */
  id?: string;
  /** Expiry as a Unix timestamp in seconds. */
  exp: number;
};

/**
 * One day in seconds: the interim dev session is a transitional stack, so its
 * cookie no longer lives for a whole week. `DEV_SESSION_TTL` still overrides
 * it when a longer session is really needed.
 */
export const DEFAULT_DEV_SESSION_TTL = 86_400;

/** Reads `DEV_SESSION_TTL` (seconds), falling back to one day. */
export function readDevSessionTtl(raw: string | undefined): number {
  const ttl = Number(raw);

  return Number.isInteger(ttl) && ttl > 0 ? ttl : DEFAULT_DEV_SESSION_TTL;
}

/** Narrows a decoded value to the dev session shape. */
export function isDevSessionPayload(
  value: unknown,
): value is DevSessionPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<DevSessionPayload>;

  if (candidate.role !== 'admin' && candidate.role !== 'user') {
    return false;
  }

  const validId =
    candidate.role === 'user'
      ? typeof candidate.id === 'string' &&
        candidate.id.trim().length > 0 &&
        candidate.id.trim() !== 'dev-admin'
      : candidate.id === undefined || typeof candidate.id === 'string';

  return (
    typeof candidate.email === 'string' &&
    candidate.email.length > 0 &&
    typeof candidate.exp === 'number' &&
    Number.isFinite(candidate.exp) &&
    (candidate.name === undefined || typeof candidate.name === 'string') &&
    validId
  );
}

/** Whether the session reached its expiry, `now` included. */
export function isDevSessionExpired(
  payload: DevSessionPayload,
  now: number,
): boolean {
  return payload.exp <= now;
}
