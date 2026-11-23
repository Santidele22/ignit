import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  isDevSessionExpired,
  isDevSessionPayload,
  type DevSessionPayload,
} from './dev-session-payload.js';

/** Encodes one token segment as base64url. */
function toBase64Url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

/** Decodes one base64url token segment. */
function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

/** Signs the payload as `<payload>.<hmac>`, both base64url. */
export function signDevSession(
  payload: DevSessionPayload,
  secret: string,
): string {
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(encodedPayload)
    .digest();

  return `${encodedPayload}.${toBase64Url(signature)}`;
}

/**
 * Verifies a token and returns its payload, or `null` when the signature, the
 * shape or the expiry do not hold. The signature is checked first, so a forged
 * payload is never parsed as a session.
 */
export function verifyDevSession(
  token: string,
  secret: string,
  now: number,
): DevSessionPayload | null {
  const parts = token.split('.');

  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, encodedSignature] = parts as [string, string];

  if (!encodedPayload || !encodedSignature) {
    return null;
  }

  const signature = fromBase64Url(encodedSignature);
  const expected = createHmac('sha256', secret)
    .update(encodedPayload)
    .digest();

  if (
    signature.length !== expected.length ||
    !timingSafeEqual(signature, expected)
  ) {
    return null;
  }

  let payload: unknown;

  try {
    payload = JSON.parse(fromBase64Url(encodedPayload).toString('utf8'));
  } catch {
    return null;
  }

  if (!isDevSessionPayload(payload) || isDevSessionExpired(payload, now)) {
    return null;
  }

  return payload;
}
