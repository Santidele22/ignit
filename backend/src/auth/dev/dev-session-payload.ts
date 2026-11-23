/**
 * Shape of the signed dev session and the lifetime rules attached to it.
 *
 * The payload carries its own `exp`, so the default TTL, the `DEV_SESSION_TTL`
 * parsing and the expiry predicate live next to the shape they describe.
 */

/**
 * Content of the signed dev session cookie. `role` is always `admin`: the
 * interim mode knows a single account, the one in the `.env`.
 */
export type DevSessionPayload = {
  email: string;
  name?: string;
  role: 'admin';
  /** Stable id of the interim administrator, used as ownerId by the admin panels. */
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

  return (
    typeof candidate.email === 'string' &&
    candidate.email.length > 0 &&
    candidate.role === 'admin' &&
    typeof candidate.exp === 'number' &&
    Number.isFinite(candidate.exp) &&
    (candidate.name === undefined || typeof candidate.name === 'string') &&
    (candidate.id === undefined || typeof candidate.id === 'string')
  );
}

/** Whether the session reached its expiry, `now` included. */
export function isDevSessionExpired(
  payload: DevSessionPayload,
  now: number,
): boolean {
  return payload.exp <= now;
}
