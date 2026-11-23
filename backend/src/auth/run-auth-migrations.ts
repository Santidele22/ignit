import { pathToFileURL } from 'node:url';
import { getMigrations } from 'better-auth/db/migration';
import { createAuth } from './auth.js';

/**
 * Creates the Better Auth schema (`user`, `account`, `session`, `verification`
 * and the admin plugin columns) with the same migration API the Better Auth
 * CLI uses. Better Auth owns these tables; TypeORM never migrates them.
 *
 * Run it against the local database with:
 * `docker compose up -d && DATABASE_URL=postgres://app:app@localhost:5432/personal_page pnpm build && DATABASE_URL=... BETTER_AUTH_SECRET=... node dist/auth/run-auth-migrations.js`
 */
export async function runAuthMigrations(): Promise<string[]> {
  const migrations = await getMigrations(createAuth().options, {
    throwOnUnsafe: false,
  });

  await migrations.runMigrations();

  return migrations.toBeCreated.map(({ table }) => table);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // Migrations go over Neon's direct connection: the pooled (-pooler)
  // endpoint is PgBouncer in transaction mode, which drops the session state
  // DDL relies on. `createAuth` reads DATABASE_URL, so prefer the unpooled
  // string before building the instance.
  process.env.DATABASE_URL =
    process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  const created = await runAuthMigrations();
  console.log(
    created.length > 0
      ? `Better Auth tables created: ${created.join(', ')}`
      : 'Better Auth schema already up to date',
  );
}
