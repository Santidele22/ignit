import {
  isNoAuthAllowed,
  neonAuthConfigError,
  noAuthStartupError,
  resolveAuthMode,
} from './auth-mode.js';

describe('resolveAuthMode', () => {
  const logger = { warn: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the Better Auth stack when AUTH_MODE is not configured', () => {
    expect(resolveAuthMode({}, logger)).toBe('better');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('uses the interim dev auth only when AUTH_MODE=dev and the env is complete', () => {
    expect(
      resolveAuthMode(
        {
          AUTH_MODE: 'dev',
          ADMIN_EMAIL: 'admin@example.com',
          ADMIN_PASSWORD: 'dev-password',
          DEV_SESSION_SECRET: 'dev-session-secret-for-tests',
        },
        logger,
      ),
    ).toBe('dev');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back to Better Auth and warns when AUTH_MODE=dev lacks a credential', () => {
    expect(
      resolveAuthMode(
        { AUTH_MODE: 'dev', ADMIN_EMAIL: 'admin@example.com' },
        logger,
      ),
    ).toBe('better');
    expect(resolveAuthMode({ AUTH_MODE: 'dev' }, logger)).toBe('better');
    expect(logger.warn).toHaveBeenCalledTimes(2);

    const [message] = logger.warn.mock.calls[0] as [string];
    expect(message).toContain('AUTH_MODE=dev');
    expect(message).toContain('ADMIN_EMAIL');
    expect(message).toContain('ADMIN_PASSWORD');
  });

  it('treats blank credentials as missing', () => {
    expect(
      resolveAuthMode(
        { AUTH_MODE: 'dev', ADMIN_EMAIL: '   ', ADMIN_PASSWORD: 'dev-password' },
        logger,
      ),
    ).toBe('better');
    expect(
      resolveAuthMode(
        { AUTH_MODE: 'dev', ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: '' },
        logger,
      ),
    ).toBe('better');
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('refuses dev mode without DEV_SESSION_SECRET, even with full credentials', () => {
    // An empty HMAC key makes the cookie forgeable: the secret is required,
    // and the app warns and falls back instead of signing loosely.
    expect(
      resolveAuthMode(
        { AUTH_MODE: 'dev', ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'dev-password' },
        logger,
      ),
    ).toBe('better');
    expect(
      resolveAuthMode(
        {
          AUTH_MODE: 'dev',
          ADMIN_EMAIL: 'admin@example.com',
          ADMIN_PASSWORD: 'dev-password',
          DEV_SESSION_SECRET: '   ',
        },
        logger,
      ),
    ).toBe('better');
    expect(logger.warn).toHaveBeenCalledTimes(2);

    const [message] = logger.warn.mock.calls[0] as [string];
    expect(message).toContain('DEV_SESSION_SECRET');
  });

  it('uses managed Neon Auth only for the production store', () => {
    expect(resolveAuthMode({ AUTH_MODE: 'neon', DB_MODE: 'prod' }, logger)).toBe('neon');
    expect(resolveAuthMode({ AUTH_MODE: 'neon', DB_MODE: 'dev' }, logger)).toBe('better');
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('ignores any other AUTH_MODE value', () => {
    expect(
      resolveAuthMode(
        {
          AUTH_MODE: 'better',
          ADMIN_EMAIL: 'admin@example.com',
          ADMIN_PASSWORD: 'dev-password',
        },
        logger,
      ),
    ).toBe('better');
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('neonAuthConfigError', () => {
  it('requires both managed auth HTTPS URLs', () => {
    expect(neonAuthConfigError({ AUTH_MODE: 'neon', DB_MODE: 'prod' })).toContain(
      'NEON_AUTH_BASE_URL',
    );
    expect(
      neonAuthConfigError({
        AUTH_MODE: 'neon',
        DB_MODE: 'prod',
        NEON_AUTH_BASE_URL: 'http://auth.example.com/auth',
      }),
    ).toContain('NEON_AUTH_BASE_URL');
    expect(
      neonAuthConfigError({
        AUTH_MODE: 'neon',
        DB_MODE: 'prod',
        NEON_AUTH_BASE_URL: 'https://auth.example.com/auth',
      }),
    ).toContain('NEON_AUTH_JWKS_URL');
  });

  it('accepts a complete production config and ignores other modes', () => {
    expect(
      neonAuthConfigError({
        AUTH_MODE: 'neon',
        DB_MODE: 'prod',
        NEON_AUTH_BASE_URL: 'https://auth.example.com/auth',
        NEON_AUTH_JWKS_URL: 'https://auth.example.com/auth/.well-known/jwks.json',
      }),
    ).toBeNull();
    expect(neonAuthConfigError({})).toBeNull();
  });
});

describe('isNoAuthAllowed', () => {
  it('accepts only the exact value true', () => {
    expect(isNoAuthAllowed({ ALLOW_NO_AUTH: 'true' })).toBe(true);
    expect(isNoAuthAllowed({ ALLOW_NO_AUTH: 'TRUE' })).toBe(false);
    expect(isNoAuthAllowed({ ALLOW_NO_AUTH: '1' })).toBe(false);
    expect(isNoAuthAllowed({ ALLOW_NO_AUTH: 'yes' })).toBe(false);
    expect(isNoAuthAllowed({})).toBe(false);
  });
});

describe('noAuthStartupError', () => {
  it('allows the boot when an auth stack is mounted', () => {
    expect(noAuthStartupError({}, true)).toBeNull();
    // Mounted stacks boot whatever the opt-out says.
    expect(noAuthStartupError({ ALLOW_NO_AUTH: 'true' }, true)).toBeNull();
  });

  it('aborts the boot with a clear error when no stack is mounted', () => {
    const message = noAuthStartupError({}, false);

    expect(message).toContain('Refusing to boot');
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('AUTH_MODE=dev');
    expect(message).toContain('ALLOW_NO_AUTH=true');
  });

  it('honours the explicit ALLOW_NO_AUTH opt-out', () => {
    expect(noAuthStartupError({ ALLOW_NO_AUTH: 'true' }, false)).toBeNull();
    // Anything else than the exact opt-out keeps the boot fail-closed.
    expect(noAuthStartupError({ ALLOW_NO_AUTH: 'yes' }, false)).not.toBeNull();
  });

  it('explains that DB_MODE=dev ignores DATABASE_URL instead of blaming a missing URL', () => {
    const message = noAuthStartupError(
      { DB_MODE: 'dev', DATABASE_URL: 'postgresql://app:app@localhost:5432/ignit' },
      false,
    );

    expect(message).toContain('Refusing to boot');
    expect(message).toContain('DB_MODE=dev');
    expect(message).toContain('SQLite');
    expect(message).toContain('DB_MODE=dev-neon');
    expect(message).toContain('AUTH_MODE=dev');
    expect(message).toContain('ALLOW_NO_AUTH=true');
    expect(message).not.toContain('no DATABASE_URL');
    expect(
      noAuthStartupError(
        {
          DB_MODE: 'dev',
          DATABASE_URL: 'postgresql://app:app@localhost:5432/ignit',
          ALLOW_NO_AUTH: 'true',
        },
        false,
      ),
    ).toBeNull();
  });
});
