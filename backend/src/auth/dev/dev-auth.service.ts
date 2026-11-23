import { Injectable } from '@nestjs/common';
import {
  DEV_SESSION_COOKIE,
  devSessionCookie,
  matchesCredential,
  readCookie,
  readDevSessionTtl,
  signDevSession,
  verifyDevSession,
} from './dev-session.js';
import type { DevRole, DevSessionPayload } from './dev-session.js';
import { type DevLoginLimit, DevLoginLimiter, devLoginLimitConfig } from './dev-login-limiter.js';

/** Key the per-IP login limiter falls back to when the IP is missing. */
const LOGIN_LIMIT_UNKNOWN_IP = 'unknown';

/** Authenticated user in local `AUTH_MODE=dev` (either `.env` admin or local account). */
export type DevUser = {
  id: string;
  email: string;
  name: string;
  role: DevRole;
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Interim dev auth: verifies the credentials from the environment and keeps the
 * session in a signed cookie, so no database and no Better Auth are involved.
 *
 * The environment is read on every call, like `src/auth/auth.ts` does, so the
 * values always come from the running process.
 */
@Injectable()
export class DevAuthService {
  /**
   * Login-throttle state of this process. The limits are read from the
   * environment once at startup — the throttle can accumulate failure
   * counts in memory between calls, so unlike the credential getters below
   * the config cannot be re-read per attempt without losing the window.
   */
  private readonly loginLimiter = new DevLoginLimiter(devLoginLimitConfig(process.env));

  private get adminEmail(): string {
    return (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  }

  private get adminPassword(): string {
    return process.env.ADMIN_PASSWORD ?? '';
  }

  private get adminName(): string {
    return process.env.ADMIN_NAME?.trim() || 'Admin';
  }

  private get sessionSecret(): string {
    // Never sign with an empty HMAC key: it makes the cookie forgeable (a
    // token minted with the same key would verify). `AUTH_MODE=dev` is gated
    // on a non-empty `DEV_SESSION_SECRET` (auth-mode.ts), so this only throws
    // on a misconfigured process, and it fails closed.
    const secret = process.env.DEV_SESSION_SECRET?.trim() ?? '';
    if (!secret) {
      throw new Error(
        '[auth] DEV_SESSION_SECRET is required for the dev session.',
      );
    }
    return secret;
  }

  private get sessionTtl(): number {
    return readDevSessionTtl(process.env.DEV_SESSION_TTL);
  }

  /**
   * Whether one more login attempt is allowed from `ip`, under the per-IP
   * limiter (issue #38: hardcoded credentials otherwise invite brute force).
   */
  checkLoginLimit(ip: string | undefined): DevLoginLimit {
    return this.loginLimiter.check(ip ?? LOGIN_LIMIT_UNKNOWN_IP);
  }

  /** Registers one failed login for `ip`, opening its retry window. */
  recordLoginFailure(ip: string | undefined): void {
    this.loginLimiter.recordFailure(ip ?? LOGIN_LIMIT_UNKNOWN_IP);
  }

  /** Clears the failures of `ip` after a successful login. */
  clearLoginFailures(ip: string | undefined): void {
    this.loginLimiter.reset(ip ?? LOGIN_LIMIT_UNKNOWN_IP);
  }

  /** Whether `email` matches the configured `.env` administrator email. */
  isAdminEmail(email: string): boolean {
    return (
      this.adminEmail.length > 0 &&
      email.trim().toLowerCase() === this.adminEmail
    );
  }

  /**
   * Emails are compared without case or surrounding spaces; the password is
   * compared byte for byte. Both comparisons are timing safe.
   */
  verifyCredentials(email: string, password: string): boolean {
    const emailMatches = matchesCredential(
      email.trim().toLowerCase(),
      this.adminEmail,
    );
    const passwordMatches = matchesCredential(password, this.adminPassword);

    return emailMatches && passwordMatches;
  }

  /** Signs a new session and returns its cookie plus the user it represents. */
  createSession(
    secure = false,
    user?: DevUser,
  ): { cookie: string; user: DevUser } {
    const subject: DevUser = user ?? {
      id: 'dev-admin',
      email: this.adminEmail,
      name: this.adminName,
      role: 'admin',
    };
    const payload: DevSessionPayload = {
      id: subject.id,
      email: subject.email,
      name: subject.name,
      role: subject.role,
      exp: nowSeconds() + this.sessionTtl,
    };

    return {
      cookie: devSessionCookie(
        signDevSession(payload, this.sessionSecret),
        this.sessionTtl,
        secure,
      ),
      user: this.toUser(payload),
    };
  }

  /**
   * Returns the user of a valid session cookie, or `null` when the cookie is
   * missing, forged, expired or belongs to a different administrator (for
   * example after `ADMIN_EMAIL` changed).
   */
  readSession(cookieHeader: string | undefined): DevUser | null {
    const token = readCookie(cookieHeader, DEV_SESSION_COOKIE);

    if (!token) {
      return null;
    }

    const payload = verifyDevSession(token, this.sessionSecret, nowSeconds());

    if (!payload) {
      return null;
    }

    if (payload.role === 'admin' && payload.email !== this.adminEmail) {
      return null;
    }

    return this.toUser(payload);
  }

  /** Expires the cookie the browser holds. */
  clearSessionCookie(secure: boolean): string {
    return devSessionCookie('', 0, secure);
  }

  private toUser(payload: DevSessionPayload): DevUser {
    if (payload.role === 'user') {
      return {
        id: payload.id as string,
        email: payload.email,
        name: payload.name ?? payload.email,
        role: 'user',
      };
    }

    return {
      id: payload.id ?? 'dev-admin',
      email: payload.email,
      name: payload.name ?? this.adminName,
      role: 'admin',
    };
  }
}
