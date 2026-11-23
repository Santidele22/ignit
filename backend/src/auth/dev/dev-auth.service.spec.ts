import { Test, TestingModule } from '@nestjs/testing';
import { DevAuthService } from './dev-auth.service.js';
import { DEV_SESSION_COOKIE, signDevSession } from './dev-session.js';

const ADMIN_EMAIL = 'Admin@Example.com';
const ADMIN_PASSWORD = 'dev-password';
const DEV_SESSION_SECRET = 'dev-session-secret-for-tests';
const nowSeconds = () => Math.floor(Date.now() / 1000);

describe('DevAuthService', () => {
  let service: DevAuthService;

  /** Only the `dev_session` pair of a serialised cookie, for a `Cookie` header. */
  function cookiePair(cookie: string): string {
    return cookie.split('; ')[0] as string;
  }

  beforeEach(async () => {
    process.env.ADMIN_EMAIL = ADMIN_EMAIL;
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.DEV_SESSION_SECRET = DEV_SESSION_SECRET;
    delete process.env.ADMIN_NAME;
    delete process.env.DEV_SESSION_TTL;
    delete process.env.DEV_LOGIN_MAX_ATTEMPTS;
    delete process.env.DEV_LOGIN_WINDOW_SECONDS;

    const module: TestingModule = await Test.createTestingModule({
      providers: [DevAuthService],
    }).compile();

    service = module.get(DevAuthService);
  });

  afterAll(() => {
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.DEV_SESSION_SECRET;
    delete process.env.ADMIN_NAME;
    delete process.env.DEV_SESSION_TTL;
    delete process.env.DEV_LOGIN_MAX_ATTEMPTS;
    delete process.env.DEV_LOGIN_WINDOW_SECONDS;
  });

  describe('verifyCredentials', () => {
    it('accepts the configured email ignoring case and surrounding spaces', () => {
      expect(service.verifyCredentials(ADMIN_EMAIL, ADMIN_PASSWORD)).toBe(true);
      expect(service.verifyCredentials('  admin@example.com  ', ADMIN_PASSWORD)).toBe(
        true,
      );
    });

    it('rejects a wrong password or a wrong email', () => {
      expect(service.verifyCredentials(ADMIN_EMAIL, 'wrong-password')).toBe(false);
      expect(service.verifyCredentials('intruder@example.com', ADMIN_PASSWORD)).toBe(
        false,
      );
      expect(service.verifyCredentials(ADMIN_EMAIL, '')).toBe(false);
    });
  });

  describe('createSession', () => {
    it('signs a one-day admin session and serialises it as a server-only cookie', () => {
      const session = service.createSession(false);

      expect(session.user).toEqual({
        email: 'admin@example.com',
        name: 'Admin',
        role: 'admin',
        id: 'dev-admin',
      });
      expect(session.cookie).toContain('Path=/');
      expect(session.cookie).toContain('HttpOnly');
      expect(session.cookie).toContain('SameSite=Lax');
      expect(session.cookie).toContain('Max-Age=86400');
      expect(session.cookie).not.toContain('Secure');
      expect(service.readSession(cookiePair(session.cookie))).toEqual(session.user);
    });

    it('adds Secure over secure transports', () => {
      expect(service.createSession(true).cookie).toContain('Secure');
    });

    it('honours DEV_SESSION_TTL and ADMIN_NAME', () => {
      process.env.DEV_SESSION_TTL = '120';
      process.env.ADMIN_NAME = 'Santi';

      const session = service.createSession(false);

      expect(session.cookie).toContain('Max-Age=120');
      expect(session.user.name).toBe('Santi');
    });

    it('signs and reads back a local multi-account user session', () => {
      const localUser = {
        id: 'user-alice',
        email: 'alice@example.com',
        name: 'Alice',
        role: 'user' as const,
      };

      const session = service.createSession(false, localUser);

      expect(session.user).toEqual(localUser);
      expect(service.readSession(cookiePair(session.cookie))).toEqual(localUser);
    });
  });

  describe('readSession', () => {
    it('returns the user of a valid cookie', () => {
      const { cookie, user } = service.createSession();

      expect(service.readSession(cookiePair(cookie))).toEqual(user);
      expect(
        service.readSession(`other=1; ${cookiePair(cookie)}`),
      ).toEqual(user);
    });

    it('returns null without a cookie or with an unrelated one', () => {
      expect(service.readSession(undefined)).toBeNull();
      expect(service.readSession('')).toBeNull();
      expect(service.readSession(`${DEV_SESSION_COOKIE}=`)).toBeNull();
      expect(service.readSession('other=1')).toBeNull();
    });

    it('returns null when the signature was not made with DEV_SESSION_SECRET', () => {
      const forged = signDevSession(
        {
          email: 'admin@example.com',
          name: 'Admin',
          role: 'admin',
          exp: nowSeconds() + 600,
        },
        'another-secret',
      );

      expect(service.readSession(`${DEV_SESSION_COOKIE}=${forged}`)).toBeNull();
    });

    it('returns null for an expired session and for another administrator', () => {
      const expired = signDevSession(
        {
          email: 'admin@example.com',
          name: 'Admin',
          role: 'admin',
          exp: nowSeconds() - 10,
        },
        DEV_SESSION_SECRET,
      );
      const otherAdmin = signDevSession(
        {
          email: 'someone-else@example.com',
          name: 'Someone',
          role: 'admin',
          exp: nowSeconds() + 600,
        },
        DEV_SESSION_SECRET,
      );

      expect(service.readSession(`${DEV_SESSION_COOKIE}=${expired}`)).toBeNull();
      expect(service.readSession(`${DEV_SESSION_COOKIE}=${otherAdmin}`)).toBeNull();
    });
  });

  describe('login throttle wiring', () => {
    // Fresh instance: the limiter snapshot limits from the environment at
    // construction, so these cases build their own service per scenario.
    const buildService = () => {
      const moduleRef = Test.createTestingModule({
        providers: [DevAuthService],
      }).compile();

      return moduleRef;
    };

    it('blocks the login after the configured failed attempts (issue #38)', async () => {
      process.env.DEV_LOGIN_MAX_ATTEMPTS = '2';
      process.env.DEV_LOGIN_WINDOW_SECONDS = '60';
      service = await (await buildService()).get(DevAuthService);

      expect(service.checkLoginLimit('10.0.0.1')).toEqual({
        allowed: true,
        retryAfterSeconds: 0,
      });

      service.recordLoginFailure('10.0.0.1');
      expect(service.checkLoginLimit('10.0.0.1').allowed).toBe(true);

      service.recordLoginFailure('10.0.0.1');
      const blocked = service.checkLoginLimit('10.0.0.1');
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

      // Other addresses keep their own counters.
      expect(service.checkLoginLimit('10.0.0.2').allowed).toBe(true);

      // A success clears the counter again.
      service.clearLoginFailures('10.0.0.1');
      expect(service.checkLoginLimit('10.0.0.1').allowed).toBe(true);
    });

    it('keys missing IPs together', async () => {
      process.env.DEV_LOGIN_MAX_ATTEMPTS = '1';
      process.env.DEV_LOGIN_WINDOW_SECONDS = '60';
      service = await (await buildService()).get(DevAuthService);

      service.recordLoginFailure(undefined);
      expect(service.checkLoginLimit(undefined).allowed).toBe(false);
    });
  });

  describe('clearSessionCookie', () => {
    it('expires the cookie the browser holds', () => {
      expect(service.clearSessionCookie(false)).toBe(
        `${DEV_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      );
      expect(service.clearSessionCookie(true)).toBe(
        `${DEV_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
      );
    });
  });
});
