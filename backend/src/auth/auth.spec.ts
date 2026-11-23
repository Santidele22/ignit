import { describe, expect, it } from 'vitest';
import { authOptions } from './auth.js';

describe('Ignit Better Auth configuration', () => {
  it('enables email/password sign-in and public sign-up for multi-user registration', () => {
    const options = authOptions();

    expect(options.emailAndPassword).toMatchObject({
      enabled: true,
      disableSignUp: false,
    });
  });
});
