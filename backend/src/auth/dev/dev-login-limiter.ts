/**
 * In-memory fixed-window limiter for the interim dev login (`AUTH_MODE=dev`).
 *
 * `dev-login` verifies hardcoded credentials, so without a throttle anyone
 * who can reach the endpoint can brute-force `ADMIN_PASSWORD`. The limiter
 * counts failures per client key (the request IP) and blocks further attempts
 * until the window elapses; a successful login resets the counter.
 *
 * The window state is per-process memory: it resets on restart and does not
 * coordinate across replicas. That matches the interim dev mode, which is a
 * single-account, single-process setup by definition.
 */

/** Result of asking whether an attempt is currently allowed. */
export type DevLoginLimit = {
  allowed: boolean;
  /** Whole seconds until a blocked key may try again (0 when allowed). */
  retryAfterSeconds: number;
};

export type DevLoginLimitConfig = {
  /** Failed attempts within one window that trip the block. */
  maxAttempts: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

type FailureRecord = {
  count: number;
  firstFailure: number;
};

/** Reads a positive integer, falling back when the value is not one. */
export function readPositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);

  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Reads the limiter configuration from the environment on every call, like
 * `src/auth/auth.ts` and `DevAuthService` do, so the running process decides.
 */
export function devLoginLimitConfig(env: NodeJS.ProcessEnv): DevLoginLimitConfig {
  return {
    maxAttempts: readPositiveInt(env.DEV_LOGIN_MAX_ATTEMPTS, 5),
    windowMs: readPositiveInt(env.DEV_LOGIN_WINDOW_SECONDS, 60) * 1000,
  };
}

export class DevLoginLimiter {
  private readonly failures = new Map<string, FailureRecord>();

  constructor(
    private readonly config: DevLoginLimitConfig,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Whether one more attempt is allowed for the key. A stale record (its
   * window elapsed) is dropped, so blocked keys unblock by themselves.
   */
  check(key: string): DevLoginLimit {
    const failure = this.failures.get(key);

    if (!failure) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const elapsed = this.now() - failure.firstFailure;
    if (elapsed >= this.config.windowMs) {
      this.failures.delete(key);
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (failure.count >= this.config.maxAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((this.config.windowMs - elapsed) / 1000),
      };
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Registers one failed attempt for the key, opening its window if new. */
  recordFailure(key: string): void {
    const nowMs = this.now();
    const failure = this.failures.get(key);

    if (!failure || nowMs - failure.firstFailure >= this.config.windowMs) {
      this.failures.set(key, { count: 1, firstFailure: nowMs });
      return;
    }

    failure.count += 1;
  }

  /** Clears the failures of a key after a successful login. */
  reset(key: string): void {
    this.failures.delete(key);
  }
}
