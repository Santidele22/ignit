import { Pool } from 'pg';
import { DataSource } from 'typeorm';
import { Book } from '../books/entities/book.entity.js';
import { DownloadEvent } from '../books/entities/download-event.entity.js';
import { ReadingState } from '../books/entities/reading-state.entity.js';
import { User } from '../users/entities/user.entity.js';

/**
 * One-off additive schema sync for PostgreSQL production (`DB_MODE=prod`).
 * Ensures the `user` shadow table exists (supporting both Better Auth
 * self-hosted and Neon Managed Auth) before synchronizing Ignit domain tables
 * (`books`, `download_events`, `reading_states`).
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('sync-schema: DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL is required.');
  }

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
