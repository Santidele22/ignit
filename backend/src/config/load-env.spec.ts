import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from './load-env.js';

describe('loadEnv', () => {
  const dirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'ignit-load-env-'));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads variables from .env when only .env exists', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), 'PORT=4000\nAUTH_MODE=dev\n');
    const env: NodeJS.ProcessEnv = {};

    const loaded = loadEnv(dir, env);

    expect(loaded).toEqual([join(dir, '.env')]);
    expect(env.PORT).toBe('4000');
    expect(env.AUTH_MODE).toBe('dev');
  });

  it('loads variables from .env.local when only .env.local exists', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env.local'), 'PORT=4100\nDB_MODE=dev-neon\n');
    const env: NodeJS.ProcessEnv = {};

    const loaded = loadEnv(dir, env);

    expect(loaded).toEqual([join(dir, '.env.local')]);
    expect(env.PORT).toBe('4100');
    expect(env.DB_MODE).toBe('dev-neon');
  });

  it('gives .env.local precedence over .env while keeping fallback keys from .env', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), 'PORT=4000\nCORS_ORIGINS=http://localhost:4321\n');
    writeFileSync(join(dir, '.env.local'), 'PORT=4200\nAUTH_MODE=dev\n');
    const env: NodeJS.ProcessEnv = {};

    const loaded = loadEnv(dir, env);

    expect(loaded).toEqual([join(dir, '.env.local'), join(dir, '.env')]);
    expect(env.PORT).toBe('4200');
    expect(env.AUTH_MODE).toBe('dev');
    expect(env.CORS_ORIGINS).toBe('http://localhost:4321');
  });

  it('never overrides variables already set in processEnv', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), 'DB_MODE=prod\nPORT=4000\n');
    writeFileSync(join(dir, '.env.local'), 'DB_MODE=dev-neon\nPORT=4200\n');
    const env: NodeJS.ProcessEnv = { DB_MODE: 'dev' };

    loadEnv(dir, env);

    expect(env.DB_MODE).toBe('dev');
    expect(env.PORT).toBe('4200');
  });

  it('does nothing when neither .env.local nor .env exists', () => {
    const dir = makeTempDir();
    const env: NodeJS.ProcessEnv = { EXISTING: '1' };

    const loaded = loadEnv(dir, env);

    expect(loaded).toEqual([]);
    expect(env).toEqual({ EXISTING: '1' });
  });
});
