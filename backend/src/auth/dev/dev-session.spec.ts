import {
  DEFAULT_DEV_SESSION_TTL,
  DEV_SESSION_COOKIE,
  devSessionCookie,
  matchesCredential,
  readCookie,
  readDevSessionTtl,
  signDevSession,
  verifyDevSession,
} from './dev-session.js';
import type { DevSessionPayload } from './dev-session.js';

const secret = 'dev-session-secret-for-tests';
const now = 1_700_000_000;
const payload: DevSessionPayload = {
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin',
  exp: now + 3600,
};

describe('signDevSession / verifyDevSession', () => {
  it('round-trips a signed payload', () => {
    const token = signDevSession(payload, secret);

    expect(token.split('.')).toHaveLength(2);
    expect(verifyDevSession(token, secret, now)).toEqual(payload);
  });

  it('rejects a token signed with another secret', () => {
    const token = signDevSession(payload, 'another-secret');

    expect(verifyDevSession(token, secret, now)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const [, signature] = signDevSession(payload, secret).split('.') as [
      string,
      string,
    ];
    const tampered = Buffer.from(
      JSON.stringify({ ...payload, email: 'intruder@example.com' }),
    ).toString('base64url');

    expect(verifyDevSession(`${tampered}.${signature}`, secret, now)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const [encodedPayload] = signDevSession(payload, secret).split('.') as [
      string,
      string,
    ];
    const forged = Buffer.from('forged-signature').toString('base64url');

    expect(verifyDevSession(`${encodedPayload}.${forged}`, secret, now)).toBeNull();
    expect(
      verifyDevSession(`${encodedPayload}.${forged}.extra`, secret, now),
    ).toBeNull();
  });

  it('rejects a token whose expiry has passed', () => {
    const expired = signDevSession({ ...payload, exp: now - 1 }, secret);

    expect(verifyDevSession(expired, secret, now)).toBeNull();
    expect(
      verifyDevSession(signDevSession({ ...payload, exp: now }, secret), secret, now),
    ).toBeNull();
  });

  it('rejects malformed and unsigned values', () => {
    for (const token of ['', 'payload', '.', 'payload.', '.signature']) {
      expect(verifyDevSession(token, secret, now)).toBeNull();
    }
  });

  it('rejects a correctly signed payload that is not a dev session', () => {
    for (const value of [
      { email: 'admin@example.com', role: 'user', exp: now + 60 },
      { email: 'admin@example.com', role: 'admin' },
      { email: '', role: 'admin', exp: now + 60 },
      { email: 'admin@example.com', role: 'admin', exp: 'soon' },
      null,
      'admin@example.com',
    ]) {
      const token = signDevSession(value as unknown as DevSessionPayload, secret);

      expect(verifyDevSession(token, secret, now)).toBeNull();
    }
  });
});

describe('matchesCredential', () => {
  it('accepts the exact value', () => {
    expect(matchesCredential('dev-password', 'dev-password')).toBe(true);
  });

  it('rejects a different value with the same and with another length', () => {
    expect(matchesCredential('dev-passwore', 'dev-password')).toBe(false);
    expect(matchesCredential('dev-password-longer', 'dev-password')).toBe(false);
    expect(matchesCredential('', 'dev-password')).toBe(false);
    expect(matchesCredential('dev-password', '')).toBe(false);
  });

  it('compares hashes, so an empty expected value never matches', () => {
    expect(matchesCredential('anything', '')).toBe(false);
  });
});

describe('readDevSessionTtl', () => {
  it('defaults to one day in seconds', () => {
    expect(DEFAULT_DEV_SESSION_TTL).toBe(86_400);
    expect(readDevSessionTtl(undefined)).toBe(86_400);
  });

  it('reads the configured lifetime', () => {
    expect(readDevSessionTtl('120')).toBe(120);
  });

  it('falls back to the default when the value is not a positive integer', () => {
    for (const raw of ['', '0', '-5', 'soon', '12.5']) {
      expect(readDevSessionTtl(raw)).toBe(DEFAULT_DEV_SESSION_TTL);
    }
  });
});

describe('readCookie / devSessionCookie', () => {
  it('reads the dev session among the other cookies', () => {
    expect(
      readCookie('other=1; dev_session=token-value; another=2', DEV_SESSION_COOKIE),
    ).toBe('token-value');
    expect(readCookie('other=1', DEV_SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(undefined, DEV_SESSION_COOKIE)).toBeUndefined();
  });

  it('writes the attributes that keep the cookie server-only', () => {
    expect(devSessionCookie('token-value', 604800)).toBe(
      `${DEV_SESSION_COOKIE}=token-value; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
    );
  });

  it('adds Secure only for secure transports', () => {
    expect(devSessionCookie('token-value', 86_400, true)).toBe(
      `${DEV_SESSION_COOKIE}=token-value; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400; Secure`,
    );
    expect(devSessionCookie('token-value', 86_400, false)).not.toContain('Secure');
  });

  it('expires the cookie for the logout', () => {
    expect(devSessionCookie('', 0)).toBe(
      `${DEV_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
  });
});
