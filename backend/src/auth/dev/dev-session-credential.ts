import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compares a credential sent by the client against the configured one with
 * `timingSafeEqual`. Both values are hashed first: `timingSafeEqual` needs
 * equal-length buffers and the digest keeps the comparison independent of the
 * value length, so the raw secret never leaks through timing.
 */
export function matchesCredential(provided: string, expected: string): boolean {
  const providedDigest = createHash('sha256').update(provided).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();

  return timingSafeEqual(providedDigest, expectedDigest);
}
