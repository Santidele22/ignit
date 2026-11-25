import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import * as src from './sw-source';
import { SW_PATH, SW_SCOPE, shouldRegisterServiceWorker, isUpdateReady } from './registerSW';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const builtSW = read('../../../public/sw.js');
const swSource = read('./sw-source.ts');
const regSource = read('./registerSW.ts');
const toastCss = read('./sw-toast.css');
const manifest = JSON.parse(read('../../../public/manifest.webmanifest'));
const layouts = [
  read('../../app/layouts/BibliotecaLayout.astro'),
  read('../../app/layouts/LandingLayout.astro'),
];

describe('S1 bypass matrix', () => {
  it('bypasses api, protocol-relative/cross-origin and every non-GET', () => {
    for (const p of ['/api', '/api/', '/api/books', '//evil.com/x.js', 'https://evil.com/api/books'])
      expect(src.shouldBypassCache(p), p).toBe(true);
    for (const m of ['POST', 'post', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'get '])
      expect(src.shouldBypassCache('/biblioteca', { method: m }), m).toBe(true);
    expect(src.shouldBypassCache('/biblioteca', { method: 'get' })).toBe(false);
    expect(src.shouldBypassCache('')).toBe(true);
    expect(src.shouldBypassCache(new URL('https://ignit.invalid/api/books'))).toBe(true);
  });
  it('classifies assets and shell navigations', () => {
    for (const p of ['/_astro/app.css', '/fonts/a.woff2?v=2', '/icons/icon-512.png'])
      expect(src.isCacheableAsset(p), p).toBe(true);
    for (const p of ['/api/x.css', '/biblioteca', '/biblioteca/x.png', '/other/x.css', '/fonts/', '/sw.js'])
      expect(src.isCacheableAsset(p), p).toBe(false);
    for (const p of ['/biblioteca', '/biblioteca/sala', '/lecturas/abc'])
      expect(src.isNavigationForShell(p), p).toBe(true);
    for (const p of ['/lecturas', '/', '/login', '/bibliotecafoo'])
      expect(src.isNavigationForShell(p), p).toBe(false);
  });
  it('pins v1 and deletes only older own caches', () => {
    expect(src.SW_VERSION).toBe('v1');
    expect(src.cacheNamesFor('v1')).toEqual({ shell: 'ignit-shell-v1', runtime: 'ignit-runtime-v1' });
    expect(src.shouldDeleteCache('ignit-shell-v0', 'v1')).toBe(true);
    expect(src.shouldDeleteCache('ignit-shell-v1', 'v1')).toBe(false);
    expect(src.shouldDeleteCache('ignit-offline-v1', 'v1')).toBe(false);
  });
  it('built sw.js is classic and message-gated', () => {
    expect(() => new vm.Script(builtSW)).not.toThrow();
    expect(builtSW).not.toMatch(/^\s*(import|export)[\s{*]/m);
    expect((builtSW.match(/skipWaiting\(\)/g) ?? []).length).toBe(1);
    expect((builtSW.match(/claim\(\)/g) ?? []).length).toBe(1);
    expect(builtSW).toContain('ignoreSearch');
  });
});

describe('S4 worker never touches reading data', () => {
  it('has no IndexedDB/api-books coupling', () => {
    for (const n of ['ignit-offline-v1', 'indexedDB', '/api/books']) {
      expect(swSource, n).not.toContain(n);
      expect(builtSW, n).not.toContain(n);
    }
  });
});

describe('S2 registration gate + toast', () => {
  it('registers only for prod + sw-capable browsers', () => {
    expect(shouldRegisterServiceWorker({ prod: true, server: false, hasServiceWorker: true })).toBe(true);
    expect(shouldRegisterServiceWorker({ prod: false, server: false, hasServiceWorker: true })).toBe(false);
    expect(shouldRegisterServiceWorker({ prod: true, server: true, hasServiceWorker: true })).toBe(false);
    expect(shouldRegisterServiceWorker({ prod: true, server: false, hasServiceWorker: false })).toBe(false);
  });
  it('reloads once, posts SKIP_WAITING, no html sinks, polite live region', () => {
    expect(regSource).toContain('import.meta.env.PROD');
    expect(regSource).toContain('reloadRequested');
    expect(SW_PATH).toBe('/sw.js');
    expect(SW_SCOPE).toBe('/');
    expect(regSource).not.toMatch(/\.innerHTML|\.outerHTML|\.insertAdjacentHTML|document\.write\(/);
    expect(regSource).toContain("setAttribute('role', 'status')");
    expect(regSource).toContain("setAttribute('aria-live', 'polite')");
  });
  it('toast CSS keeps fixed, safe-area, 44px', () => {
    expect(toastCss).toMatch(/position:\s*fixed/);
    expect(toastCss).toMatch(/min-height:\s*44px/);
    expect(toastCss).toMatch(/min-width:\s*44px/);
    expect(toastCss).toContain('env(safe-area-inset-bottom)');
    expect(toastCss).toContain('env(safe-area-inset-right)');
    expect(isUpdateReady('installed')).toBe(true);
    for (const s of ['parsed', 'installing', 'activated', 'activating', 'redundant'])
      expect(isUpdateReady(s), s).toBe(false);
  });
  it('is mounted from both shells without is:inline', () => {
    expect(read('../library/components/BibliotecaApp.tsx')).toContain('registerServiceWorker()');
    const header = read('../landing/components/LandingHeader.astro');
    expect(header).toContain('registerServiceWorker()');
    expect(header).not.toContain('is:inline');
  });
});

describe('S3 manifest + icons + layouts', () => {
  it('declares identity, entry point, display, colours', () => {
    expect([manifest.name, manifest.short_name]).toEqual(['Ignit', 'Ignit']);
    expect(manifest.start_url).toBe('/biblioteca');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect([manifest.background_color, manifest.theme_color]).toEqual(['#04050a', '#04050a']);
    expect(manifest.lang).toBe('es');
  });
  it('ships real 192/512 any+maskable and 180 apple icons', () => {
    const icons = manifest.icons as Array<{ sizes: string; purpose?: string; src: string; type: string }>;
    const cases: Array<[string, string, number]> = [
      ['192x192', 'any', 192], ['192x192', 'maskable', 192],
      ['512x512', 'any', 512], ['512x512', 'maskable', 512], ['180x180', 'any', 180],
    ];
    for (const [sizes, purpose, px] of cases) {
      const icon = icons.find((i) => i.sizes === sizes && (i.purpose ?? '') === purpose);
      expect(icon, `${sizes}/${purpose}`).toBeDefined();
      const url = new URL(`../../../public${icon!.src}`, import.meta.url);
      expect(existsSync(url)).toBe(true);
      const png = readFileSync(url);
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([px, px]);
    }
  });
  it('links manifest + apple-touch-icon + theme-color in both layouts and reader', () => {
    const reader = read('../../pages/lecturas/[id].astro');
    for (const src of [...layouts, reader]) {
      expect(src).toContain('rel="manifest" href="/manifest.webmanifest"');
      expect(src).toContain('rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png"');
      expect(src).toContain('<meta name="theme-color" content="#04050a" />');
    }
  });
  it('ships Cloudflare _headers with no-cache for /sw.js and manifest content-type', () => {
    const headersFile = read('../../../public/_headers');
    expect(headersFile).toContain('/sw.js');
    expect(headersFile).toContain('Cache-Control: no-cache');
    expect(headersFile).toContain('/manifest.webmanifest');
    expect(headersFile).toContain('application/manifest+json');
  });
});
