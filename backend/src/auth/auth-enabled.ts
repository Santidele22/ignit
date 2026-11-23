import { postgresBacked } from '../config/db-mode.js';

/**
 * Better Auth needs PostgreSQL: its adapter talks to `DATABASE_URL` through a
 * `pg` pool. When the data store is not PostgreSQL the app falls back to
 * SQLite (in-memory for tests, a file for Docker-less local dev) and Better
 * Auth is not mounted at all.
 *
 * `postgresBacked` (not the raw `DATABASE_URL`) decides: an explicit
 * `DB_MODE=dev` keeps the local SQLite store — and Better Auth off — even
 * when `DATABASE_URL` is set. Read while modules are imported, so it must
 * stay side effect free: entities use it to know whether Better Auth
 * (PostgreSQL) or TypeORM (SQLite) owns the identity tables.
 */
export const isAuthEnabled = postgresBacked;
