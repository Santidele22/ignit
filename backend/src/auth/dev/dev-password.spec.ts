import { describe, expect, it } from 'vitest';
import { hashDevPassword, verifyDevPassword } from './dev-password.js';

describe('dev-password', () => {
  it('hashes with a random salt and verifies matching passwords', async () => {
    const first = await hashDevPassword('secret-pass-1');
    const second = await hashDevPassword('secret-pass-1');

    expect(first).not.toBe(second);
    expect(await verifyDevPassword('secret-pass-1', first)).toBe(true);
    expect(await verifyDevPassword('secret-pass-1', second)).toBe(true);
    expect(await verifyDevPassword('wrong-pass', first)).toBe(false);
  });

  it('rejects malformed stored hashes safely', async () => {
    for (const bad of ['', 'no-colon', 'short:hash', 'zz'.repeat(16) + ':' + '00'.repeat(64)]) {
      expect(await verifyDevPassword('secret-pass-1', bad)).toBe(false);
    }
  });
});
