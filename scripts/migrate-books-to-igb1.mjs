#!/usr/bin/env node
/**
 * Idempotent migration script: converts existing books (`reading.json` / PDFs)
 * to compact `IGB1` blobs and optionally purges legacy PDFs & JSON sidecars.
 *
 * Usage:
 *   node scripts/migrate-books-to-igb1.mjs --dry-run
 *   node scripts/migrate-books-to-igb1.mjs --apply --purge
 */
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const purgeLegacy = args.has('--purge');
const dryRun = !apply;

const distDir = resolve(process.cwd(), 'backend/dist');
if (!existsSync(distDir)) {
  console.error('Missing backend/dist. Run `cd backend && pnpm build` first.');
  process.exit(1);
}

const { loadEnv } = await import('../backend/dist/config/load-env.js');
loadEnv();

const { DataSource } = await import('typeorm');
const { buildDatabaseOptions } = await import('../backend/dist/config/database.config.js');
const { Book } = await import('../backend/dist/books/entities/book.entity.js');
const { createBookStorage } = await import('../backend/dist/books/storage/book-storage.js');
const { migrateBooksToIgb1 } = await import('../backend/dist/books/igb/igb1.migrator.js');

const dataSource = new DataSource({
  ...(buildDatabaseOptions(process.env)),
  synchronize: false,
});

await dataSource.initialize();
try {
  const booksRepository = dataSource.getRepository(Book);
  const bookStorage = createBookStorage(process.env);
  const report = await migrateBooksToIgb1({
    booksRepository,
    bookStorage,
    dryRun,
    purgeLegacy: apply && purgeLegacy,
  });
  console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'apply', purgeLegacy: apply && purgeLegacy, ...report }, null, 2));
} finally {
  await dataSource.destroy();
}
