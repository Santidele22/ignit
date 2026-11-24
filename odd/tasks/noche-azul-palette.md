# Noche Azul Palette

Feature: Add the new `noche-azul` color palette from `design/ignit-inmersiva/` alongside the existing `original` palette across the Ignit web app and Vigilia reader.
Branch: `feat/noche-azul-palette`

## Specs

- **S1**: Two selectable color palettes exist across the app: `"noche-azul"` (from `design/ignit-inmersiva/04-lampara-brutalista.html`: `--negro:#04050a`, `--panel:#060810`, `--panel-2:#080c17`, `--fg:#e6edf7`, `--body:#b9c6dd`, `--faint:#8296b8`, `--ghost:#67779a`, `--border:#232941`, `--border-strong:#344064`, `--azul:#5f86c9`, `--azul-claro:#9fc0ee`; reader `--v-bg:#060913`, `--v-bar:rgba(6,9,19,.94)`) and `"original"` (the existing warm paper/dark app palette and warm `#0d0a07` Vigilia reader palette).
- **S2**: `"noche-azul"` is the default active palette on first visit when no saved preference exists.
- **S3**: `"noche-azul"` is always dark blue monochrome faithful to `design/ignit-inmersiva/` (ignores OS light mode, sets dark `color-scheme`, uses `#04050a`/`#060913` surfaces and `#5f86c9`/`#9fc0ee` blue accents with `#04050a` foreground contrast on `--aka`; interior `--b-*` hairlines/surfaces are contrast-adjusted higher than the raw artboard, see L3). `"original"` preserves existing light/dark behavior (`santi-theme` / `prefers-color-scheme`) and warm reader tokens unchanged.
- **S4**: Zero-FOUC inline boot in `ThemeScript.astro` applies `data-palette`, `.dark`, and `color-scheme` before first paint across all HTML shells (`BaseLayout.astro`, `LibraryLayout.astro`, `login.astro`, `registro.astro`, and `lecturas/[id].astro`), with its exact SHA-256 hash registered in `web/astro.config.mjs` `security.csp.scriptDirective.hashes`.
- **S5**: Palette switcher UI appears in both the global header (`BaseLayout.astro`, `LibraryLayout.astro`) and the reader preferences panel (`ReaderDecks.astro`), synced to the same `localStorage` key (`ignit:palette`) and synced across controls/tabs.
- **S6**: All reader surfaces, borders, progress wires, ambient mood glows, dust motes, code blocks, and overlays adapt cleanly to `"noche-azul"` via CSS tokens (no warm brown/red bleed-through in `noche-azul`), while `"original"` stays visually unchanged; `design/system.md` is updated to document the new tokens.

## Tasks

- [x] T1 (S1, S2, S3, S4) | inline | Core palette model (`web/src/shared/lib/palette.ts` + tests), `ThemeScript.astro` FOUC boot + CSP hash in `web/astro.config.mjs`, and mounting `ThemeScript` in `lecturas/[id].astro` | commit: `bc7bcec`
- [x] T2 (S1, S3, S5, S6) | writer | App-shell `noche-azul` tokens in `global.css`, `--aka-foreground` token replacing hardcoded `#fdf8ee`/`#fdfbf5`, header `PaletteToggle.astro` in `BaseLayout.astro` & `LibraryLayout.astro`, and `design/system.md` update | commit: `fc3996a`
- [x] T3 (S1, S3, S5, S6) | writer | Reader CSS tokenization (`reader-tokens.css`, `reader-chrome.css`, `reader-stage.css`, `reader-panels.css`, `reader-vigilia.css`, `ReaderMargins.astro`), CSS-driven mood glows (`feedback.ts`), and synced Paleta row in `ReaderDecks.astro` + `widgets/reading/prefs.ts`/`decks.ts` | commit: `a33559d`
- [x] T4 (S1–S6) | verify | Independent verification (`gentle-ai-verify`) PASSED S1–S6 (0 blockers; 144/144 tests, `astro build`, `astro check` 0 errors, built CSP hash verified); native review consent declined by user for this candidate | commit: verified at `a33559d`

## Log

- **L1**: "Vamos a agregarle a la app la nueva paleta de colores de http://127.0.0.1:42265/UIpkF7TkzuJPd6oyCORMmWEqqTSHwfGV/d/ignit-inmersiva/ vamos a tener dos opciones la original y noche-azul."
- **L2**: User answers via `ask_user_question`:
  1. "¿Cuál paleta debería venir activa por defecto la primera vez que alguien entra a la app?" — `Noche azul`
  2. "¿Dónde querés mostrar el selector entre Original y Noche azul?" — `Header + lector (Recomendado)`
  3. "En design/ignit-inmersiva, Noche azul es siempre oscura y monocromática azul (#04050a + #5f86c9). ¿Cómo querés aplicarla?" — `Fiel al diseño: siempre oscura azul (Recomendado)`

- **L3**: "Bien, ahora corrijamos un poco los colores porque estan muy oscuros y no es muy accesible. (solo admin y app por dentro)" — deliberate departure from full artboard fidelity (see L2 answer 3): only interior surfaces/hairlines lift. S1/S3 updated: text ink and accents keep the artboard values; `--b-*` interior tokens (biblioteca.css + admin.css noche-azul blocks) move to panel `#0a101c`, panel-2 `#10182e`, border `#4d5c86` (3.1:1), border-strong `#56658f` (3.3:1), bar-track `#233054`, surface-cover `#131a2e`, faint `#a9bcdf` (9.9:1), ghost `#93a6cc` (7.8:1); `original`-palette ghost mix 62%→86%, border-strong mix 26%→45%. Global tokens, reader ink (`--w-*`), PWA `#04050a`, and landing `--l-*` untouched. Disabled-opacity states audited: correct convention, unchanged.
