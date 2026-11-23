import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { hashPassword } from 'better-auth/crypto';
import { Pool } from 'pg';

export interface SeedAdminInput {
  databaseUrl: string;
  email: string;
  password: string;
  name?: string;
  role?: string;
}

export type SeedAdminResult = 'created' | 'exists';

export async function seedAdmin({
  databaseUrl,
  email,
  password,
  name,
  role = 'admin',
}: SeedAdminInput): Promise<SeedAdminResult> {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail) {
    throw new Error('seed-admin: ADMIN_EMAIL is required.');
  }
  if (!password) {
    throw new Error('seed-admin: ADMIN_PASSWORD is required.');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const existing = await pool.query('select id from "user" where email = $1', [
      normalizedEmail,
    ]);
    if (existing.rowCount && existing.rowCount > 0) {
      return 'exists';
    }

    const passwordHash = await hashPassword(password);
    const userId = randomUUID();
    const now = new Date();
    const displayName = name?.trim() || normalizedEmail;

    await pool.query(
      `insert into "user"
         (id, name, email, "emailVerified", "createdAt", "updatedAt", role)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, displayName, normalizedEmail, true, now, now, role],
    );
    await pool.query(
      `insert into "account"
         (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        userId,
        'credential',
        userId,
        passwordHash,
        now,
        now,
      ],
    );

    return 'created';
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('seed-admin: DATABASE_URL is required.');
  }

  const result = await seedAdmin({
    databaseUrl,
    email: process.env.ADMIN_EMAIL ?? '',
    password: process.env.ADMIN_PASSWORD ?? '',
    name: process.env.ADMIN_NAME,
  });

  console.log(
    result === 'created'
      ? `Admin created: ${process.env.ADMIN_EMAIL?.trim().toLowerCase()}`
      : `Admin already exists: ${process.env.ADMIN_EMAIL?.trim().toLowerCase()} (left unchanged)`,
  );
}
