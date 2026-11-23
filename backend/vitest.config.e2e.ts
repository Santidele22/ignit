import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // The boot is fail-closed: importing AppModule without an auth stack
    // aborts. The CRUD and boot-path suites intentionally run the guard-less
    // SQLite fallback (no DATABASE_URL, no AUTH_MODE=dev), so this suite opts
    // out exactly like the documented local-dev escape hatch. Specs that
    // mount a stack (auth.e2e-spec.ts, dev-auth.e2e-spec.ts) are unaffected.
    env: { ALLOW_NO_AUTH: 'true' },
  },
});
