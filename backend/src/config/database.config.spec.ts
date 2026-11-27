import { buildDatabaseOptions } from './database.config.js';

describe('buildDatabaseOptions', () => {
  it('configures resilient pg pool timeouts and keepAlive for prod Postgres', () => {
    const options = buildDatabaseOptions(
      {
        DB_MODE: 'prod',
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@ep-pooler.neon.tech/db',
        DATABASE_URL_UNPOOLED: 'postgresql://user:pass@ep.neon.tech/db',
      },
      'prod',
      true,
    );

    expect(options).toMatchObject({
      type: 'postgres',
      url: 'postgresql://user:pass@ep-pooler.neon.tech/db?sslmode=verify-full',
      synchronize: false,
      extra: {
        max: 10,
        idleTimeoutMillis: 20_000,
        connectionTimeoutMillis: 30_000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10_000,
      },
    });
  });

  it('uses SQLite without Postgres pool options in dev mode', () => {
    const options = buildDatabaseOptions({ NODE_ENV: 'test' }, 'dev', false);
    expect(options).toMatchObject({
      type: 'better-sqlite3',
      database: ':memory:',
    });
    expect(options).not.toHaveProperty('extra');
  });
});
