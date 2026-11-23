import { Pool } from 'pg';
import { DataSource } from 'typeorm';

/**
 * One-off additive schema sync for PostgreSQL production (`DB_MODE=prod`).
 * Sets DB_MODE/DATABASE_URL before importing `User` so `isAuthEnabled` stays
 * true even when invoked with only `DATABASE_URL_UNPOOLED`.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('sync-schema: DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL is required.');
  }

  process.env.DB_MODE ??= 'prod';
  process.env.DATABASE_URL ??= databaseUrl;

  const [{ User }, { Book }, { DownloadEvent }, { ReadingState }] = await Promise.all([
    import('../users/entities/user.entity.js'),
    import('../books/entities/book.entity.js'),
    import('../books/entities/download-event.entity.js'),
    import('../books/entities/reading-state.entity.js'),
  ]);

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`
      create table if not exists "user" (
        "id" text primary key,
        "name" text not null,
        "email" text unique not null,
        "emailVerified" boolean not null default false,
        "role" text
      )
    `);
  } finally {
    await pool.end();
  }

  const dataSource = new DataSource({
    type: 'postgres',
    url: databaseUrl,
    entities: [User, Book, DownloadEvent, ReadingState],
    synchronize: true,
  });

  await dataSource.initialize();
  await dataSource.destroy();
  console.log('· sync-schema: Ignit domain schema synchronized');
}

main().catch((error) => {
  console.error('· sync-schema failed:', error);
  process.exit(1);
});
