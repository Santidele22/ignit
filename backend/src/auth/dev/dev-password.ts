import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const HEX_PATTERN = /^[0-9a-f]+$/i;

/**
 * Hashes a local dev-account password using Node's built-in scrypt and a random
 * 16-byte salt, serialized as `<saltHex>:<derivedKeyHex>`.
 */
export async function hashDevPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const derived = (await scryptAsync(password, salt, KEY_BYTES)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

/** Verifies a candidate password against a `<saltHex>:<derivedKeyHex>` hash. */
export async function verifyDevPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 2) {
    return false;
  }

  const [salt, keyHex] = parts as [string, string];
  if (
    salt.length !== SALT_BYTES * 2 ||
    keyHex.length !== KEY_BYTES * 2 ||
    !HEX_PATTERN.test(salt) ||
    !HEX_PATTERN.test(keyHex)
  ) {
    return false;
  }

  const expected = Buffer.from(keyHex, 'hex');
  const actual = (await scryptAsync(password, salt, KEY_BYTES)) as Buffer;

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
