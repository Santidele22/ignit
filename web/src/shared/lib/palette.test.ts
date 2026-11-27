import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	DEFAULT_PALETTE,
	PALETTE_STORAGE_KEY,
	parsePalette,
	resolveDocumentThemeState,
} from './palette';

describe('app palette helpers', () => {
	it('defaults to noche-azul and parses valid palette values safely', () => {
		expect(DEFAULT_PALETTE).toBe('noche-azul');
		expect(PALETTE_STORAGE_KEY).toBe('ignit:palette');

		expect(parsePalette(null)).toBe('noche-azul');
		expect(parsePalette(undefined)).toBe('noche-azul');
		expect(parsePalette('')).toBe('noche-azul');
		expect(parsePalette('calido')).toBe('noche-azul');
		expect(parsePalette('noche-azul')).toBe('noche-azul');
		expect(parsePalette('original')).toBe('original');
	});

	it('forces dark monochrome state for noche-azul regardless of OS or santi-theme', () => {
		expect(resolveDocumentThemeState('noche-azul', null, false)).toEqual({
			palette: 'noche-azul',
			dark: true,
			colorScheme: 'dark',
		});
		expect(resolveDocumentThemeState('noche-azul', 'light', false)).toEqual({
			palette: 'noche-azul',
			dark: true,
			colorScheme: 'dark',
		});
		expect(resolveDocumentThemeState('noche-azul', 'dark', true)).toEqual({
			palette: 'noche-azul',
			dark: true,
			colorScheme: 'dark',
		});
	});

	it('forces accessible light paper mode for original regardless of OS or santi-theme', () => {
		expect(resolveDocumentThemeState('original', null, false)).toEqual({
			palette: 'original',
			dark: false,
			colorScheme: 'light',
		});
		expect(resolveDocumentThemeState('original', null, true)).toEqual({
			palette: 'original',
			dark: false,
			colorScheme: 'light',
		});
		expect(resolveDocumentThemeState('original', 'dark', false)).toEqual({
			palette: 'original',
			dark: false,
			colorScheme: 'light',
		});
		expect(resolveDocumentThemeState('original', 'light', true)).toEqual({
			palette: 'original',
			dark: false,
			colorScheme: 'light',
		});
	});

	it('keeps ThemeScript inline body sha256 hash registered in astro.config.mjs CSP', () => {
		const webRoot = path.resolve(import.meta.dirname, '../../..');
		const themeScript = fs.readFileSync(
			path.join(webRoot, 'src/shared/ui/ThemeScript.astro'),
			'utf8',
		);
		const astroConfig = fs.readFileSync(
			path.join(webRoot, 'astro.config.mjs'),
			'utf8',
		);

		const match = themeScript.match(/<script is:inline>([\s\S]*?)<\/script>/);
		expect(match).not.toBeNull();
		const body = match![1];
		const hash = `sha256-${crypto.createHash('sha256').update(body).digest('base64')}`;
		expect(astroConfig).toContain(hash);
	});
});
