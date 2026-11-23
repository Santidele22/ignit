import {
  DevLoginLimiter,
  devLoginLimitConfig,
  readPositiveInt,
} from './dev-login-limiter.js';

describe('readPositiveInt', () => {
  it('reads valid positive integers', () => {
    expect(readPositiveInt('5', 60)).toBe(5);
    expect(readPositiveInt('1', 60)).toBe(1);
  });

  it('falls back when the value is missing or not a positive integer', () => {
    for (const raw of [undefined, '', '0', '-5', '12.5', 'soon']) {
      expect(readPositiveInt(raw, 60)).toBe(60);
    }
  });
});

describe('devLoginLimitConfig', () => {
  it('defaults to 5 attempts per 60 seconds', () => {
    expect(devLoginLimitConfig({})).toEqual({ maxAttempts: 5, windowMs: 60000 });
  });

  it('reads the overrides from the environment', () => {
    expect(
      devLoginLimitConfig({
        DEV_LOGIN_MAX_ATTEMPTS: '3',
        DEV_LOGIN_WINDOW_SECONDS: '120',
      }),
    ).toEqual({ maxAttempts: 3, windowMs: 120000 });
  });

  it('ignores invalid overrides', () => {
    expect(
      devLoginLimitConfig({
        DEV_LOGIN_MAX_ATTEMPTS: 'many',
        DEV_LOGIN_WINDOW_SECONDS: '0',
      }),
    ).toEqual({ maxAttempts: 5, windowMs: 60000 });
  });
});

describe('DevLoginLimiter', () => {
  const config = { maxAttempts: 3, windowMs: 60_000 };

  function createLimiter(startMs: number) {
    let current = startMs;
    const limiter = new DevLoginLimiter(config, () => current);

    return {
      limiter,
      advance: (ms: number) => {
        current += ms;
      },
    };
  }

  it('allows attempts below the limit and blocks at it', () => {
    const { limiter } = createLimiter(1_000);

    expect(limiter.check('10.0.0.1').allowed).toBe(true);

    limiter.recordFailure('10.0.0.1');
    limiter.recordFailure('10.0.0.1');

    expect(limiter.check('10.0.0.1').allowed).toBe(true);

    limiter.recordFailure('10.0.0.1');

    const blocked = limiter.check('10.0.0.1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it('keeps other keys independent', () => {
    const { limiter } = createLimiter(1_000);

    for (let i = 0; i < 3; i++) {
      limiter.recordFailure('10.0.0.1');
    }

    expect(limiter.check('10.0.0.1').allowed).toBe(false);
    expect(limiter.check('10.0.0.2').allowed).toBe(true);
  });

  it('unblocks after the window elapses', () => {
    const { limiter, advance } = createLimiter(1_000);

    for (let i = 0; i < 3; i++) {
      limiter.recordFailure('10.0.0.1');
    }
    expect(limiter.check('10.0.0.1').allowed).toBe(false);

    advance(60_000);

    const unblocked = limiter.check('10.0.0.1');
    expect(unblocked.allowed).toBe(true);
    expect(unblocked.retryAfterSeconds).toBe(0);
  });

  it('counts failures against the window they started in', () => {
    const { limiter, advance } = createLimiter(1_000);

    limiter.recordFailure('10.0.0.1');
    advance(30_000);
    limiter.recordFailure('10.0.0.1');
    advance(30_000);

    // 60 s after the first failure the window restarts instead of summing up.
    expect(limiter.check('10.0.0.1').allowed).toBe(true);
    expect(limiter.check('10.0.0.1')).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it('shrinks the retry hint as the window runs down', () => {
    const { limiter, advance } = createLimiter(1_000);

    for (let i = 0; i < 3; i++) {
      limiter.recordFailure('10.0.0.1');
    }
    advance(20_000);

    expect(limiter.check('10.0.0.1').retryAfterSeconds).toBe(40);
  });

  it('resets the counter after a successful login', () => {
    const { limiter } = createLimiter(1_000);

    limiter.recordFailure('10.0.0.1');
    limiter.recordFailure('10.0.0.1');
    limiter.reset('10.0.0.1');

    expect(limiter.check('10.0.0.1').allowed).toBe(true);

    // The reset count starts from zero again.
    for (let i = 0; i < 3; i++) {
      limiter.recordFailure('10.0.0.1');
    }
    expect(limiter.check('10.0.0.1').allowed).toBe(false);
  });
});
