# Ignit — Design System (synced)

Synced read-only from the project's two design sources. Values below exist only in these files; nothing is invented. Dark values additionally serve the requested dark, calm landing palette.

Sources: `web/src/app/styles/global.css`, `web/src/features/book/reader/reader-tokens.css`, and — for the selectable `noche-azul` palette — `design/ignit-inmersiva/04-lampara-brutalista.html`.

## Colors — light theme (`:root`, global.css)

| `--background` | `#f4efe4` | Page background (warm paper) |
| `--foreground` | `#23201a` | Primary ink text |
| `--card` | `#fbf8f0` | Card surfaces |
| `--card-foreground` | `#23201a` | Card text |
| `--popover` | `#fbf8f0` | Popover surface |
| `--popover-foreground` | `#23201a` | Popover text |
| `--primary` | `#23201a` | Primary buttons / emphasis |
| `--primary-foreground` | `#f4efe4` | Text on primary |
| `--secondary` | `#ece5d4` | Secondary surfaces |
| `--secondary-foreground` | `#23201a` | Text on secondary |
| `--muted` | `#ebe4d2` | Muted surfaces |
| `--muted-foreground` | `#6f6657` | Muted text |
| `--accent` | `#e9e1cd` | Accent surfaces |
| `--accent-foreground` | `#23201a` | Text on accent |
| `--destructive` | `#a6362f` | Danger |
| `--border` | `#ddd2bc` | Hairline borders |
| `--input` | `#ddd2bc` | Input borders |
| `--ring` | `#c73e3a` | Focus ring |
| `--aka` | `#c73e3a` | Brand red (hanko, selection, scrollbar hover) |
| `--aka-deep` | `#a02f2b` | Deep brand red |
| `--aka-foreground` | `#fdf8ee` | Text/ink on `--aka` surfaces (hanko, selection, `hover:bg-aka`) |
| `--ink-soft` | `#57503f` | Soft ink |
| `--radius` | `0.375rem` | Base radius |

## Colors — dark theme (`.dark`, global.css)

| `--background` | `#14110d` | Dark page background (warm near-black) |
| `--foreground` | `#eae3d3` | Light warm text on dark |
| `--card` | `#1c1812` | Dark card surface |
| `--card-foreground` | `#eae3d3` | Card text |
| `--popover` | `#1c1812` | Popover surface |
| `--popover-foreground` | `#eae3d3` | Popover text |
| `--primary` | `#eae3d3` | Primary (inverted ink) |
| `--primary-foreground` | `#14110d` | Text on primary |
| `--secondary` | `#241f17` | Secondary surfaces |
| `--secondary-foreground` | `#eae3d3` | Text on secondary |
| `--muted` | `#231e16` | Muted surfaces |
| `--muted-foreground` | `#a29681` | Muted text |
| `--accent` | `#2a241a` | Accent surfaces |
| `--accent-foreground` | `#eae3d3` | Text on accent |
| `--destructive` | `#d95448` | Danger |
| `--border` | `#322b20` | Hairline borders |
| `--input` | `#322b20` | Input borders |
| `--ring` | `#d95448` | Focus ring |
| `--aka` | `#d95448` | Brand red on dark |
| `--aka-deep` | `#c73e3a` | Deep brand red |
| `--aka-foreground` | `#fdf8ee` | Text/ink on `--aka` surfaces |

## Colors — `noche-azul` palette (`html[data-palette="noche-azul"]`, global.css)

Second selectable palette, always dark blue monochrome: it declares its own
surfaces and forces `color-scheme: dark`, so it never follows OS light mode and
never inherits the warm paper tokens (noche-azul palette S1/S3). Its values are
taken verbatim from `design/ignit-inmersiva/04-lampara-brutalista.html`
(`--negro`, `--panel`, `--panel-2`, `--fg`, `--body`, `--faint`, `--border`,
`--border-strong`, `--azul`, `--azul-claro`).

| `--background` | `#04050a` | Artboard `--negro` |
| `--foreground` | `#e6edf7` | Artboard `--fg` |
| `--card` | `#060810` | Artboard `--panel` |
| `--card-foreground` | `#e6edf7` | Card text |
| `--popover` | `#080c17` | Artboard `--panel-2` |
| `--popover-foreground` | `#e6edf7` | Popover text |
| `--primary` | `#e6edf7` | Primary (light ink) |
| `--primary-foreground` | `#04050a` | Text on primary |
| `--secondary` | `#080c17` | Secondary surfaces |
| `--secondary-foreground` | `#e6edf7` | Text on secondary |
| `--muted` | `#0b1020` | Muted surfaces (blue-black step) |
| `--muted-foreground` | `#8296b8` | Artboard `--faint` |
| `--accent` | `#10172b` | Accent surfaces |
| `--accent-foreground` | `#e6edf7` | Text on accent |
| `--destructive` | `#d96b73` | Danger (blue-compatible red) |
| `--border` | `#232941` | Artboard `--border` |
| `--input` | `#344064` | Artboard `--border-strong` |
| `--ring` | `#9fc0ee` | Artboard `--azul-claro` (focus) |
| `--aka` | `#5f86c9` | Artboard `--azul` (brand blue) |
| `--aka-deep` | `#43649e` | Deep brand blue |
| `--aka-foreground` | `#04050a` | Ink on `--aka` (artboard `::selection` / active toggle) |
| `--ink-soft` | `#b9c6dd` | Artboard `--body` (soft ink) |

Grain veil: `html[data-palette="noche-azul"] body::after` drops the noise
opacity to `0.5` (from `0.6` under `.dark`) so the texture stays subtle on the
blue-black surfaces.

## Colors — reader night scene (`body.vigilia-body`, reader-tokens.css)

| `--w-foreground` | `#ece5d5` | Reader emphasis text |
| `--w-body` | `#d6ccb4` | Reader body text |
| `--w-faint` | `#8f826b` | Faint reader text |
| `--w-ghost` | `#786c57` | Ghost reader text |
| `--w-border` | `#352d22` | Reader hairline borders |
| `--w-panel` | `rgba(18,14,10,.96)` | Reader panel glass |
| `--bronce` | `#b98a44` | Bronze accent (candlelight warmth) |
| `--niebla` | `#8c96a0` | Mist blue-grey accent |
| `--glow` | `rgba(201,62,58,.14)` | Ambient glow tint |
| background (literal) | `#0d0a07` | Night scene background |
| selection text (literal) | `--aka-foreground` (`#fdf8ee`) | Text on aka / aká surfaces |
| noise overlay (literal) | opacity `0.045` base / `0.6` dark / `0.5` `noche-azul` | SVG fractal-noise grain veil |

## Colors — reader `noche-azul` scene (`html[data-palette="noche-azul"] body.vigilia-body`, reader-tokens.css)

Reader counterpart of the app palette, taken verbatim from
`design/ignit-inmersiva/04-lampara-brutalista.html` (`.demo-lectura`). No warm
brown/red value bleeds through when the reader runs in `noche-azul` (S6);
`original` keeps the warm scene above untouched.

| `--w-bg` | `#060913` | Reader scene background (artboard `--v-bg`) |
| `--w-bar` | `rgba(6,9,19,.94)` | Reader top/bottom bar glass (artboard `--v-bar`) |
| `--w-panel` | `rgba(6,8,16,.96)` | Reader panel glass |
| `--w-border` | `#232941` | Reader hairline borders (artboard `--v-border`) |
| `--w-border-hover` | `#344064` | Strong hover border (artboard `--border-strong`) |
| `--w-foreground` | `#e6edf7` | Reader emphasis text (artboard `--v-fg`) |
| `--w-body` | `#b9c6dd` | Reader body text (artboard `--v-body`) |
| `--w-faint` | `#8296b8` | Faint reader text (artboard `--v-faint`) |
| `--w-ghost` | `#67779a` | Ghost reader text (artboard `--v-ghost`) |
| `--w-wire-1` | `#5f86c9` | Progress wire start (artboard `--v-wire1`) |
| `--w-wire-2` | `#9fc0ee` | Progress wire end (artboard `--v-wire2`) |
| `--aka` | `#5f86c9` | Reader accent (artboard `--v-accent`) |
| `--aka-deep` | `#43649e` | Deep blue accent |
| `--bronce` | `#9fc0ee` | Secondary luminous blue highlight (artboard `--azul-claro`) |
| `--w-dust` | `#9fc0ee` | Drifting dust motes |
| `--glow-espera` | `rgba(95,134,201,.15)` | Ambient lamp glow (mood-driven via `[data-mood]`) |

## Typography

| `--font-zen` → `--font-sans` | Zen Kaku Gothic New stack (sans) |
| `--font-shippori` → `--font-mincho` | Shippori Mincho stack (serif, reader passages and editorial headings) |
| `--font-geist-mono` → `--font-mono` | Geist Mono stack |
| `font-feature-settings` | `"palt" 1` on body |

In self-contained artboards (no external fonts), approximate with system stacks: `system-ui, sans-serif` for Zen and `Georgia, 'Times New Roman', serif` for Mincho.

## Spacing, radius, motion

| `--radius` | `0.375rem`; scales `-4px / -2px / +0 / +4px` for `sm/md/lg/xl` |
| `.reveal` animation | `0.7s cubic-bezier(0.21,0.47,0.32,0.98)`, fade + 20px rise |
| `.breathe` animation | 9s ease-in-out glow breathing (reader) |
| `.drift` animation | 22–29s dust motes drifting (reader) |
| `prefers-reduced-motion` | All animations/transition durations zeroed globally |

## Component rules (found in sources)

- **Hanko seal** (`.hanko`): inline-flex square in `--aka` with `--aka-foreground` text; seals and stamps.
- **Toggle / segmented control** (`.tema-toggle` in the artboard, `PaletteToggle.astro` in the app): 1px `--border`/`--border-strong` frame on `--card`/`--panel`, mono uppercase `10px` with wide tracking; the active option is `--aka` background with `--aka-foreground` text and semibold weight (`aria-pressed="true"` drives it).
- **Noise grain veil** (global + reader): fixed full-screen SVG turbulence overlay, very low opacity.
- **Focus**: `:focus-visible` 2px `--aka` outline, 3px offset; `--ring`-based outline globally.
- **Selection**: `--aka` background with `--aka-foreground` text.
- **Scrollbar**: transparent track, `color-mix` muted thumb, 999px radius, 3px background border; `--aka` on hover.
- **Active chips** (projects): ink-on-ink swap (`foreground` bg, `background` text), `--aka` on hover.
- **View transitions**: `navigation: auto` cross-document.
- **Ambient scene** (reader): fixed radial `--glow` breathing at top, elliptical vignette, drifting dust motes `#d8cdb4`.
- **Marquee**: 36s linear infinite, pauses on hover/focus-within.
