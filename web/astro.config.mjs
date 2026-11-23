// @ts-check

import solidJs from '@astrojs/solid-js';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, fontProviders } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

const apiBaseUrl = process.env.PUBLIC_API_BASE_URL?.replace(/\/+$/, '') ?? '';
const apiOrigin = /^https?:\/\//i.test(apiBaseUrl) ? new URL(apiBaseUrl).origin : '';

export default defineConfig({
	site: 'https://ignit-web.workers.dev',
	integrations: [solidJs()],
	adapter: cloudflare(),
	output: 'server',
	security: {
		csp: {
			directives: [
				"default-src 'none'",
				apiOrigin ? `connect-src 'self' ${apiOrigin}` : "connect-src 'self'",
				"img-src 'self' https: data:",
				"font-src 'self'",
				"base-uri 'self'",
				"form-action 'self'",
			],
			scriptDirective: {
				resources: ["'self'"],
				hashes: [
					'sha256-4j2Fjb5t5epKsFGmCGFD0NPY/2JEZi9pUW8KeCytZFk=',
					'sha256-VmEf2BGdqVUwcvyhTyarJo/bY7DNqS2+T2sz4IO/kbw=',
				],
			},
			styleDirective: {
				resources: [{ resource: "'unsafe-inline'", kind: 'attribute' }],
			},
		},
	},
	vite: {
		plugins: [tailwindcss()],
		server: {
			proxy: {
				'/api': {
					target: 'http://localhost:3000',
					changeOrigin: false,
					rewrite: (path) =>
						path.startsWith('/api/auth') ? path : path.replace(/^\/api/, ''),
				},
			},
		},
	},
	fonts: [
		{
			provider: fontProviders.local(),
			name: 'Shippori Mincho',
			cssVariable: '--font-shippori',
			fallbacks: ['serif'],
			options: {
				variants: [
					{ src: ['./src/assets/fonts/shippori-mincho-400-latin.woff2'], weight: 400, style: 'normal', display: 'swap' },
					{ src: ['./src/assets/fonts/shippori-mincho-600-latin.woff2'], weight: 600, style: 'normal', display: 'swap' },
				],
			},
		},
		{
			provider: fontProviders.local(),
			name: 'Zen Kaku Gothic New',
			cssVariable: '--font-zen',
			fallbacks: ['sans-serif'],
			options: {
				variants: [
					{ src: ['./src/assets/fonts/zen-kaku-gothic-new-400-latin.woff2'], weight: 400, style: 'normal', display: 'swap' },
					{ src: ['./src/assets/fonts/zen-kaku-gothic-new-500-latin.woff2'], weight: 500, style: 'normal', display: 'swap' },
					{ src: ['./src/assets/fonts/zen-kaku-gothic-new-700-latin.woff2'], weight: 700, style: 'normal', display: 'swap' },
				],
			},
		},
		{
			provider: fontProviders.local(),
			name: 'Geist Mono',
			cssVariable: '--font-geist-mono',
			fallbacks: ['monospace'],
			options: {
				variants: [
					{ src: ['./src/assets/fonts/geist-mono-400-latin.woff2'], weight: 400, style: 'normal', display: 'swap' },
					{ src: ['./src/assets/fonts/geist-mono-600-latin.woff2'], weight: 600, style: 'normal', display: 'swap' },
				],
			},
		},
	],
});
