import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // The boot is fail-closed: no auth stack mounted aborts unless the owner
    // opts out explicitly. Unit specs never import AppModule, and the e2e
    // suites that intentionally boot the guard-less SQLite fallback get the
    // opt-out from their own config.
    env: { ALLOW_NO_AUTH: 'true' },
  },
});
