# Landing Page — Lámpara Brutalista

Feature: Implement the Ignit landing page on `/` based on `design/ignit-inmersiva/04-lampara-brutalista.html` using the project's Astro + SolidJS + Tailwind v4 stack and `design/system.md` tokens.
Branch: `feat/noche-azul-palette`

## Specs

- **S1**: Route `/` (`web/src/pages/index.astro`) implements the full 6-section Lámpara brutalista landing page (`design/ignit-inmersiva/04-lampara-brutalista.html`) using the project's self-hosted fonts (`--font-zen`, `--font-shippori`, `--font-geist-mono`) and semantic tokens so it matches the artboard under `noche-azul` while remaining legible and cohesive under `original` (light and dark).
- **S2**: Chrome and navigation preserve the artboard's fixed glass header (with `熒` hanko seal, section anchors `#s2`/`#s3`/`#s4`/`#s5`, `PaletteToggle`, and auth-aware controls: `HeaderAuth` + library access when authenticated, `Entrar` + `Instalar app` when unauthenticated), top scroll progress thread (`.hiloglobal`), lateral station needle (`.mecha`), and native Canvas 2D dust motes + pointer-reactive lamp (`#escena`, `#lampara`), all respecting `prefers-reduced-motion: reduce`.
- **S3**: Section I (Hero brutalista + estantería orgánica SVG) displays the live published catalog count, CTAs, 4-cell specs strip, and interactive 3-shelf SVG populated from real published books (with a clean fallback shelf state when the catalog is empty or unavailable), updating the `aria-live` micro-HUD on hover/focus and filtering/scrolling to `#s2` on click.
- **S4**: Section II (Catálogo + descarga selectiva preview) connects to the real books API with current filters (`Todos`, `Técnico`, `No técnico`) plus instant title/author search, bespoke SVG cover motifs per book, direct links to `/lecturas/:id`, real `fileSize` (with fallback estimate when absent), and interactive offline preview toggles + device KB meter (preview only; real Service Worker / IndexedDB PWA deferred to a later phase).
- **S5**: Section III (Publicar en el catálogo) renders the interactive 4-step pipeline (`Standby`, `En curso`, `Tested`, `Catálogo`) cross-highlighted with the luminous ink-river SVG on hover/click/focus and CTAs to `/biblioteca` and `/registro`.
- **S6**: Section IV (Probalo en la app real — Vigilia embebido) embeds the real `/lecturas/:id` reader in an `<iframe src>` pre-populated with the first published book (plus a validated same-origin `/lecturas/:id` URL loader and full-screen link). `web/src/middleware.ts` allows `frame-ancestors 'self'` ONLY for `/lecturas/:id` (`isReaderRoute`) while preserving `frame-ancestors 'none'` on every other route, and `web/astro.config.mjs` allows `frame-src 'self'` without relaxing `default-src 'none'` or adding inline script hashes.
- **S7**: Section V (Desktop ↔ Celu PWA) implements the interactive continuity simulator (`En línea` / `Modo avión (bondi)`, page navigation, local pending queue, and automatic desktop catch-up on reconnect) as an interactive preview, followed by Section VI (Cierre) and footer.
- **S8**: All client interactivity runs via bundled ES module script (`script-src 'self'`, zero new inline `<script is:inline>` CSP hashes) with pure unit-tested logic helpers, passing `vitest run`, `astro check`, and `astro build`.

## Tasks

- [x] T1 (S3, S4, S5, S6, S7, S8) | inline | CSP `frame-ancestors`/`frame-src` security scoping + tests, optional `Book.fileSizeBytes` mapping, and pure landing domain modules (`catalog`, `embed`, `journey`, `pipeline`) with Vitest RED→GREEN tests | commit: `7e99fda`
- [x] T2 (S1, S2, S3, S4) | writer | `LandingLayout.astro`, semantic `landing.css` (`noche-azul` + `original`), `LandingChrome.astro`, `LandingHeader.astro`, `HeroSection.astro`, `BookCoverArt.astro`, and `CatalogSection.astro` | commit: `c62985b`
- [x] T3 (S1, S2, S5, S6, S7, S8) | writer | `PipelineSection.astro`, `ReaderEmbedSection.astro`, `JourneySection.astro`, `ClosingSection.astro`, and bundled client runtime `initLanding.ts` | commit: `7c61430`
- [x] T4 (S1–S8) | inline | Wire `web/src/pages/index.astro`, run full `vitest run` + `astro check` + `astro build`, and verify live rendering on local dev server | commit: `e8ceaae`
- [x] T5 (S1–S8) | verify | Independent verification (`gentle-ai-verify` S1–S8 PASS on `ea57de7` after fixing S6 embed URL validation & pre-loaded Vigilia iframe, Risk: item 2 security CSP + shared middleware), native `gentle_review` invoked (`consent-declined-this-candidate`), and `gentle_design` handoff updated to `implemented` | commit: `ea57de7`

## Log

- **L1**: "Vamos a empezar a implementar la landing page de la app:
diseño elegido: http://127.0.0.1:57973/04-lampara-brutalista.html"
- **L2**: User answers via `ask_user_question`:
  1. Catálogo: `Catálogo real con filtros actuales (Recomendado)` — Conectar §I y §II al API actual (Todos / Técnico / No técnico), armando la estantería con libros publicados y un estado fallback si la DB está vacía.
  2. PWA y offline: `Preview interactivo, PWA real aparte (Recomendado)` — Implementar la UI interactiva del diseño (medidor de KB, descarga y modo avión como preview) y dejar el Service Worker + IndexedDB real para una fase aparte.
  3. Lector en vivo: `Iframe real con frame-ancestors 'self' (Recomendado)` — Permitir `frame-ancestors 'self'` solo en `/lecturas/*` y pre-cargar en el iframe el primer libro publicado disponible (con selector de URL).
  4. Animaciones: `Nativo liviano (Canvas 2D + SVG + CSS) (Recomendado)` — Replicar fielmente partículas en Canvas 2D, lámpara, estantería SVG y reveals con JS/CSS nativo, sin sumar dependencias pesadas.
