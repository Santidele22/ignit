# PWA Service Worker & Install

Feature: Add a Service Worker (app-shell offline for `/biblioteca` and `/lecturas/:id`), `manifest.webmanifest` with icons, and a discreet update notice to the Ignit web app, keeping IndexedDB as the reading-data store and zero inline-script CSP regressions.
Branch: `feat/pwa-service-worker`

## Specs

- **S1**: Service Worker module (`web/src/features/pwa/service-worker.ts`, bundled to `web/public/sw.js` via a build step) implementing:
  - Precache of the app shell for `/biblioteca` and the reader route skeleton on install (HTML documents fetched at install time, versioned cache names like `ignit-shell-v1`, `ignit-runtime-v1`).
  - Runtime caching: stale-while-revalidate for static assets (CSS/JS/fonts/images served from `/_astro/*` and self-hosted fonts), network-first with cache fallback for navigation requests to `/biblioteca` and `/lecturas/*`, and a graceful offline response (cached shell) when navigation fails.
  - Never caches: `/api/*` (session and auth), the backend origin, or anything with `Set-Cookie`.
  - `skipWaiting`/`clients.claim` gated behind an explicit "apply update" action from the page (no auto-update on navigation while an old page is open).
- **S2**: Registration + update notice without CSP regressions: a small bundled ES module (`web/src/features/pwa/registerSW.ts`) registers `/sw.js` on load (production only, never in dev), listens for `updatefound`/`waiting` worker states, and renders a discreet fixed toast ("Nueva versión disponible · Recargar") in the page (aria-live polite, ≥44px Recargar button, safe-area aware) that calls `postMessage({type: 'SKIP_WAITING'})` and reloads on `controllerchange`. Zero new inline `<script>` tags; all logic in bundled modules.
- **S3**: `web/public/manifest.webmanifest` with `name`, `short_name` (`Ignit`), `description`, `start_url` (`/biblioteca`), `scope`, `display` (`standalone`), `background_color`/`theme_color` (`#04050a`), and maskable+any `192px`/`512px` icons generated from the app seal (`熒 Ignit` motif). `BibliotecaLayout.astro` and `LandingLayout.astro` link the manifest and `apple-touch-icon`; icons live under `web/public/icons/`.
- **S4**: The reader keeps working offline end-to-end: cached shell + IndexedDB reading documents (existing `offlineStore.ts`) render `/lecturas/:id` without network; the SW must not interfere with the existing `loadReadingFallback` path and `/api/*` must never be served from cache.
- **S5**: All changes pass `pnpm test`, `pnpm exec astro check`, and `pnpm exec astro build` in `web/` with zero new inline-script CSP hashes (`web/astro.config.mjs` untouched); the SW file is validated syntactically (build-time check or unit test) and a focused Vitest suite covers the SW's cache-decision helpers (cacheable-path classification, version names) as pure functions.

## Tasks

- [x] T1 (S1, S4, S5) | writer | Service Worker module + build step (`sw.js`), cache-decision pure helpers with Vitest tests, app-shell precache and navigation strategy (208/208 tests, emitted sw.js 3.5 KB) | commit: `4040610`
- [x] T2 (S2, S3, S5) | writer | `registerSW.ts` + update toast, `manifest.webmanifest` + icons, layout links (`BibliotecaLayout.astro`, `LandingLayout.astro`) (223/223 tests, 0 errors astro check, clean build) | commit: 64a6aa6
- [x] T3 (S1–S5) | inline + verify | Full test/check/build (235/235 tests, 0 errors, clean build emitting sw.js/manifest/icons), live preview probes (sw.js 200 classic IIFE, manifest valid, icons PNG magic, layout links), independent `gentle-ai-verify` S1–S5 PASS, native review lineage `review-5a0d45d305084044` **approved** (R1 risk 3 findings, R4 resilience 8, R3 reliability 7 — all WARNING/SUGGESTION, acknowledged `authority: burned`) | commit: `575ebe5`

## Log

- **L1**: "Perfecto, ahora si. que llegue a prod y configuremos todo ya. por lo menos para que se pueda usar en web y ya empezamos con los service workers"
- **L2**: User answers via `ask_user_question`:
  1. Alcance SW: `App shell offline (Recomendado)` — precache del shell de /biblioteca y /lecturas + assets; los datos de lectura siguen en IndexedDB.
  2. Manifest: `SW + manifest e íconos (Recomendado)` — manifest.webmanifest, íconos y apple-touch-icon junto con el SW.
  3. Updates: `Aviso de actualización (Recomendado)` — toast discreto "Nueva versión disponible · Recargar"; sin auto-update silencioso.
- **L3**: Prod deploy completed first: `main` pushed (`0997c08..2b8d11f`), Cloudflare Worker version `b884f38b` live at https://ignit.ezedelebecq22.workers.dev (landing 200, PWA metas present, `/biblioteca` auth-gated 302, `/api/books` 200 after Render wake).
