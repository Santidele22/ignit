#!/usr/bin/env node
/**
 * Idempotent migration script: converts existing books (`reading.json` / PDFs)
 * to compact `IGB1` blobs and optionally purges legacy PDFs & JSON sidecars.
 *
 * Usage:
 *   node scripts/migrate-books-to-igb1.mjs --dry-run
 *   node scripts/migrate-books-to-igb1.mjs --apply --purge
 */
import '../backend/node_modules/reflect-metadata/Reflect.js';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const purgeLegacy = args.has('--purge');
const dryRun = !apply;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(scriptDir, '../backend/dist');
if (!existsSync(distDir)) {
  console.error('Missing backend/dist. Run `cd backend && pnpm build` first.');
  process.exit(1);
}

const { loadEnv } = await import('../backend/dist/config/load-env.js');
loadEnv(resolve(scriptDir, '../backend'));
if (process.env.DATABASE_URL_UNPOOLED && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
}

const { DataSource } = await import('../backend/node_modules/typeorm/index.js');
const { buildDatabaseOptions } = await import('../backend/dist/config/database.config.js');
const { resolveDbMode } = await import('../backend/dist/config/db-mode.js');
const { Book } = await import('../backend/dist/books/entities/book.entity.js');
const { createBookStorage } = await import('../backend/dist/books/storage/book-storage.js');
const { migrateBooksToIgb1 } = await import('../backend/dist/books/igb/igb1.migrator.js');

const mode = resolveDbMode(process.env);
const isPg = mode === 'prod' || mode === 'dev-neon' || (process.env.DB_MODE === undefined && Boolean(process.env.DATABASE_URL));
const dataSource = new DataSource({
  ...(buildDatabaseOptions(process.env, mode, isPg)),
  entities: [resolve(distDir, '**/*.entity.js')],
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
