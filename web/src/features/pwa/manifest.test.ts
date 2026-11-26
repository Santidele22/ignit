import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const publicDir = new URL('../../../public/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', publicDir), 'utf8')) as {
	name: string;
	short_name: string;
	description: string;
	start_url: string;
	scope: string;
	display: string;
	background_color: string;
	theme_color: string;
	lang: string;
	icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
	display_override?: Array<string>;
	launch_handler?: { client_mode: string };
};

const iconEntries = manifest.icons ?? [];
const findIcon = (sizes: string, purpose: string) =>
	iconEntries.find((icon) => icon.sizes === sizes && (icon.purpose ?? '').includes(purpose));

describe('manifest.webmanifest (S3)', () => {
	it('declares the Ignit app identity and the library entry point', () => {
		expect(manifest.name).toBe('Ignit');
		expect(manifest.short_name).toBe('Ignit');
		expect(manifest.description).toBe(
			'Tu sala de lectura: continuá donde quedaste, descargá libros para leer sin conexión y seguí tus aportes al catálogo de Ignit.',
		);
		expect(manifest.start_url).toBe('/biblioteca');
		expect(manifest.scope).toBe('/');
		expect(manifest.display).toBe('standalone');
		expect(manifest.display_override).toEqual(['standalone', 'fullscreen']);
		expect(manifest.launch_handler?.client_mode).toBe('focus-existing');
		expect(manifest.lang).toBe('es');
	});

	it('uses the noche-azul shell colours', () => {
		expect(manifest.background_color).toBe('#04050a');
		expect(manifest.theme_color).toBe('#04050a');
	});

	it('ships 192/512 icons for `any` and `maskable`, plus a 180px apple-touch-icon', () => {
		const required: Array<[string, string]> = [
			['192x192', 'any'],
			['192x192', 'maskable'],
			['512x512', 'any'],
			['512x512', 'maskable'],
			['180x180', 'any'],
		];
		for (const [sizes, purpose] of required) {
			const icon = findIcon(sizes, purpose);
			expect(icon, `${sizes} ${purpose}`).toBeDefined();
			expect(icon?.type).toBe('image/png');
			expect(icon?.src.startsWith('/icons/')).toBe(true);
		}
		const declared = iconEntries.find((icon) => icon.sizes === '180x180');
		expect(declared?.src).toBe('/icons/apple-touch-icon.png');
	});

	it('points at icon files that exist under web/public/icons', () => {
		for (const icon of iconEntries) {
			expect(existsSync(new URL(`.${icon.src}`, publicDir)), icon.src).toBe(true);
		}
	});
});
