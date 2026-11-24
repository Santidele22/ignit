/**
 * Regenerates the Ignit PWA icon set: `public/icons/icon.svg` -> PNG rasterizations.
 *
 * The SVG is the icon master (its full-bleed `#04050a` fill keeps the `熒 Ignit` seal
 * inside the maskable safe zone); the PNGs are derived from it and never edited by hand.
 * sharp already ships with the Astro toolchain, so it is resolved from the workspace
 * instead of adding a dependency (same packaging fallback as `build-sw.mjs`).
 */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(projectRoot, 'public/icons');
const masterIcon = path.join(iconsDir, 'icon.svg');

/** Full-bleed Ignit background; doubles as the safe-zone fill for transparent sources. */
const BACKGROUND = '#04050a';

const targets = [
	{ file: 'icon-192.png', size: 192, opaque: false },
	{ file: 'icon-512.png', size: 512, opaque: false },
	// iOS home screen: 180 px flattened onto the background, so it never ships transparency.
	{ file: 'apple-touch-icon.png', size: 180, opaque: true },
];

const pkgRequire = createRequire(path.join(projectRoot, 'package.json'));

async function loadSharp() {
	try {
		const module = await import('sharp');
		return module.default ?? module;
	} catch {
		// pnpm's strict layout does not expose transitive dependencies at the root,
		// so fall back to the copy installed for Astro.
		try {
			const astroRequire = createRequire(pkgRequire.resolve('astro/package.json'));
			return astroRequire('sharp');
		} catch {
			throw new Error(
				'sharp is not available in web/node_modules. Run `pnpm install` in web/ first.',
			);
		}
	}
}

const masterRelative = path.relative(projectRoot, masterIcon);

let svg;
try {
	svg = await readFile(masterIcon);
} catch (error) {
	throw new Error(`${masterRelative} is the icon master and is missing (${error.code}).`);
}
if (!svg.includes('viewBox=')) {
	throw new Error(`${masterRelative} is not a scalable icon master (no viewBox).`);
}

const sharp = await loadSharp();

console.log(`kept ${masterRelative} (icon master)`);

for (const { file, size, opaque } of targets) {
	const outfile = path.join(iconsDir, file);
	let pipeline = sharp(svg).resize(size, size);
	if (opaque) pipeline = pipeline.flatten({ background: BACKGROUND });
	await pipeline.png({ compressionLevel: 9 }).toFile(outfile);
	console.log(`built ${path.relative(projectRoot, outfile)} (${size}x${size}) from ${masterRelative}`);
}
