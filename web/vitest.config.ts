import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

/**
 * Scoped test config for the Solid component tests (`*.test.tsx`).
 *
 * `vite-plugin-solid` compiles JSX the same way the Astro app does, so the
 * component under test keeps its real reactive behaviour. The `browser` +
 * `development` resolve conditions make `solid-js` load its DOM build instead
 * of the server build; without them Solid renders through `dist/server.js`.
 *
 * The default environment stays `node` so the existing suite (40 files, 260
 * tests) keeps its previous behaviour byte for byte. Component tests opt into
 * a DOM per file with a `// @vitest-environment happy-dom` docblock.
 */
export default defineConfig({
	plugins: [solid({ ssr: false, hot: false })],
	resolve: {
		conditions: ['development', 'browser'],
	},
	test: {
		environment: 'node',
		isolate: false,
	},
});
