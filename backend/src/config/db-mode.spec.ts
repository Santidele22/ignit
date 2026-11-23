import { dbModeStartupError, resolveDbMode } from './db-mode.js';

describe('resolveDbMode', () => {
  const logger = { warn: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stays on the local store when DB_MODE is not configured', () => {
    expect(resolveDbMode({}, logger)).toBe('dev');
    expect(resolveDbMode({ DATABASE_URL: 'postgres://app:app@localhost:5432/personal_page' }, logger)).toBe('dev');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('uses the explicit dev mode even with DATABASE_URL set', () => {
    expect(
      resolveDbMode(
        { DB_MODE: 'dev', DATABASE_URL: 'postgres://app:app@localhost:5432/personal_page' },
        logger,
      ),
    ).toBe('dev');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('uses dev-neon and prod only with DATABASE_URL set', () => {
    expect(
      resolveDbMode(
        { DB_MODE: 'dev-neon', DATABASE_URL: 'postgres://neon-branch' },
        logger,
      ),
    ).toBe('dev-neon');
    expect(
      resolveDbMode(
        { DB_MODE: 'prod', DATABASE_URL: 'postgres://neon-main' },
        logger,
      ),
    ).toBe('prod');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back to dev and warns when dev-neon lacks DATABASE_URL', () => {
    expect(resolveDbMode({ DB_MODE: 'dev-neon' }, logger)).toBe('dev');
    expect(logger.warn).toHaveBeenCalledTimes(1);

    const [message] = logger.warn.mock.calls[0] as [string];
    expect(message).toContain('DB_MODE=dev-neon');
    expect(message).toContain('DATABASE_URL');
  });

  it('resolves prod without DATABASE_URL to dev so the startup error can abort the boot', () => {
    expect(resolveDbMode({ DB_MODE: 'prod' }, logger)).toBe('dev');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('treats unknown values as dev', () => {
    expect(resolveDbMode({ DB_MODE: 'staging' }, logger)).toBe('dev');
  });
});

describe('dbModeStartupError', () => {
  it('aborts the boot when DB_MODE=prod could not resolve to prod', () => {
    const message = dbModeStartupError({ DB_MODE: 'prod' }, 'dev');
    expect(message).toContain('DB_MODE=prod');
    expect(message).toContain('DATABASE_URL');
  });

  it('rejects a malformed DATABASE_URL before opening a PostgreSQL pool', () => {
    const message = dbModeStartupError(
      { DB_MODE: 'prod', DATABASE_URL: 'base' },
      'prod',
    );

    expect(message).toContain('Invalid DATABASE_URL');
    expect(message).toContain('complete Neon connection string');
  });

  it('rejects a non-PostgreSQL direct URL without exposing its contents', () => {
    const message = dbModeStartupError(
      {
        DB_MODE: 'dev-neon',
        DATABASE_URL: 'postgres://neon-branch',
        DATABASE_URL_UNPOOLED: 'https://secret.example.com/database',
      },
      'dev-neon',
    );

    expect(message).toContain('Invalid DATABASE_URL_UNPOOLED');
    expect(message).not.toContain('secret.example.com');
  });

  it('allows every legal startup', () => {
    expect(dbModeStartupError({}, 'dev')).toBeNull();
    expect(dbModeStartupError({ DB_MODE: 'dev' }, 'dev')).toBeNull();
    expect(
      dbModeStartupError(
        { DB_MODE: 'prod', DATABASE_URL: 'postgres://neon-main' },
        'prod',
      ),
    ).toBeNull();
    expect(
      dbModeStartupError(
        { DB_MODE: 'dev-neon', DATABASE_URL: 'postgres://neon-branch' },
        'dev-neon',
      ),
    ).toBeNull();
    expect(
      dbModeStartupError(
        { DB_MODE: 'prod', DATABASE_URL: 'postgresql://neon-main' },
        'prod',
      ),
    ).toBeNull();
  });
});
