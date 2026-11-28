# Feature: Deterministic hOCR Rescue & Resilient Reading Design Pipeline

- **Objective**: Make PDF reading extraction and reader typography deterministically resilient on degraded/scanned/historical PDFs (e.g. *Martín Fierro* Book `#57` with old DjVu/OCR layers, library stamps, and broken title pages) by adding an optical `hOCR` (`x_wconf`) rescue path, lexical/entropy noise filtering, topological `frontmatter` compaction, conservative heading consensus, and low-variance reader CSS.
- **Branch**: `feat/deterministic-hocr-reading-pipeline`
- **Delivery strategy**: `feature-branch-chain` (user selected `feature-branch chain` on `feat/deterministic-hocr-reading-pipeline` including existing v5 working-tree edits)
- **Test runner**: `pnpm --dir backend test`, `pnpm --dir backend lint`, `pnpm --dir backend build`, `pnpm --dir web test`, `ASTRO_TELEMETRY_DISABLED=1 pnpm --dir web exec astro check`

## Specs

- **S1 — Lexical Entropy Gate & Legacy-OCR Page Detection (Backend)**:
  - Extend `backend/src/books/reading/reading.ocr-rescue.ts` (`detectPagesNeedingSurgicalOcr`) and `reading.noise.ts` with deterministic lexical/entropy scoring: detect legacy/degraded OCR pages (symbol collisions `V\BRA/t`, `^ITVOFlfi^`, `JUICIO:?`, inverted camelCase `VAkIOS`, letter-digit mashups `161968`) in addition to stripped `/ToUnicode` glyphs.
  - Discard isolated high-entropy non-textual artifacts (library stamps, scan borders, ornaments) deterministically without per-book keyword lists.
  - Check: unit tests in `reading.noise.spec.ts` / `reading.ocr-rescue.spec.ts` covering *Martín Fierro*-style stamp/OCR artifacts while preserving valid literary Spanish, dialogue (`—¿Y?`), initialisms (`O.K.`), and math/code.

- **S2 — Optical `hOCR` / `TSV` Rescue with `x_wconf` Confidence Filtering (Backend)**:
  - Upgrade `reading.ocr-rescue.ts` so pages flagged for OCR can parse Tesseract `hOCR` (or `TSV`) output instead of plain text, preserving `ocr_carea` / `ocr_par` / `ocr_line` geometry and word-level `x_wconf` confidence scores.
  - Filter out low-confidence optical tokens/lines (e.g. rubber stamps, seals, margin dirt with mean `x_wconf < 55`), sanitize impossible edge punctuation, and support cross-block/cross-page dehyphenation (`cree-` + continuation).
  - Check: deterministic unit tests with fixture `hOCR` payloads verifying stamp rejection, paragraph grouping, and `pdftoppm` + `tesseract` integration on *Martín Fierro* sample pages.

- **S3 — Topological `frontmatter` Compaction & Conservative Heading Consensus (Backend)**:
  - Update `reading.xml-blocks.ts` and `reading.normalizer.ts` (`READING_EXTRACTOR_VERSION` bump if schema/output invariants change):
    - In OCR layers, quantize `fontSize` into coarse bands (`small`, `body`, `display >= 1.45×`) and widen centering tolerance so bbox X-jitter and ink-height inflation do not promote normal lines or stamps to `<h3>`.
    - Merge adjacent split uppercase fragments (e.g. `JOSÉ H,` + `NDEZ`) when neither forms an autonomous heading.
    - Compact consecutive short paratext lines in `frontmatter` (before sustained `body` prose) into a unified, quiet `meta` / edition block and deduplicate title/author lines already shown by `.book-opener`.
    - Require structural consensus for `heading` promotion (TOC match, repeated book grammar, or isolated body heading obeying density invariants: no consecutive same-level `<h3>` runs without body).
  - Check: `reading.normalizer.spec.ts` (idempotency invariant preserved), `reading.golden-archetypes.spec.ts` (new historical-OCR *Martín Fierro* archetype + existing archetypes green).

- **S4 — Low-Variance Resilient Reader Design (Web)**:
  - Audit and refine `web/src/features/book/reader/reader-stage.css` (and `web/src/features/book/lib/displayItems.ts` if needed) so `<h3>` headings do not use a left vertical border that visually collides with `blockquote`, `dialogue`, `verse`, `meta`, and `code`, and so `frontmatter` credits render with one calm, consistent editorial voice.
  - Check: `pnpm --dir web test` + `ASTRO_TELEMETRY_DISABLED=1 pnpm --dir web exec astro check` (0 errors).

- **S5 — Validation Proof on Broken *Martín Fierro* (`#57`)**:
  - Run the new deterministic `hOCR` + normalizer pipeline on the broken *Martín Fierro* PDF, inspect the resulting `frontmatter`, `heading`, `verse`, and `para` chunks side-by-side against the current broken output, and verify clean title page + prologue + sextina verse rendering before deciding on broader rollout.
  - Check: CLI extraction / diff report + reader verification on *Martín Fierro* (blocked until PDF source path / permission is confirmed).

## Tasks

| ID | Spec | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1 | inline | done | `reading.noise.ts` (`countLegacyOcrNoiseSignals`, `isOcrNoiseArtifact`), `reading.ocr-rescue.spec.ts` 6/6 |
| T2 | S2 | inline | done | `reading.ocr-rescue.ts` (`parseHocrToBlocks` with `x_wconf < 55` gate + `hocr` output), `reading.ocr-rescue.spec.ts` 6/6 |
| T3 | S3 | inline | done | `reading.types.ts` (`v6`), `reading.xml-blocks.ts` (frontmatter mono-code guard, single-line indent quote guard), `reading.normalizer.ts` (frontmatter `meta` compaction + ALL-CAPS body-exit guard), `reading.golden-archetypes.spec.ts` 5/5, `reading.normalizer.spec.ts` 6/6 |
| T4 | S4 | inline | done | `web/src/features/book/reader/reader-stage.css` (removed `h3` left border), `pnpm --dir web test` 55/55 (354/354), `astro check` 0 errors |
| T5 | S5 | inline | done | Verified on Archive.org *Martín Fierro* PDF (`152` pp, `1108` chunks, `v6`): page 5 compacted to 1 `frontmatter` `meta` block, page 6 stamps (`\BRA/t`, `OCT 161968`, `^ITVOFlfi^`) dropped, page 9 prologue 100% `para` (0 false `quote`s); backend `54/54` test files (`427/427`), `lint` 0 errors, `nest build` clean |

## Log

- **L1 (2026-11-27)**: User request: `"Vamos a entender en profundidad el tema del scrapeo porque hoy no esta el diseño como lo quiero. por ejemplo (imagen 1)..."` → `"Y si transformamos el pdf en un formato mas accesible para scrapear mejor?"` → `"Dale, y probemos con el martin fierro que ya esta roto. si lo arregla seguimos por ahi. arma la tarea en odd"` → `"continua"`.
- **L2 (2026-11-27)**: Diagnosed Image 1 (*Martín Fierro* title page + prologue): left bronze bars are `<h3>` (`align: 'left'`) from `isAllCapsSubheading` / `isLargeOrBoldHeading` in `reading.xml-blocks.ts:441-530` + `reader-stage.css:24-32`, triggered by OCR bbox X-jitter, ink-height `fontSize` inflation on library stamps (`V\BRA/t OCT 161968`, `^ITVOFlfi^`), and punctuation vetoes (`?` in `JUICIO:?`, `—` in `BUENOS AIRES—...`).
- **L3 (2026-11-27)**: Checked local environment: `tesseract`, `pdftoppm`, `pdftohtml` are installed (`tesseract --list-langs` shows `afr`, `eng`, `osd`; `spa` tessdata not installed yet). Local `backend/database.sqlite` only has books 1–2 and `backend/uploads/books/` has no book `57` (*Martín Fierro* is in Neon S3 as `.igb` per Engram `#897`). Created ODD doc; waiting on user for: (1) *Martín Fierro* PDF path/access, (2) delivery strategy (`feature-branch chain`, `stacked-to-main chain`, or `single PR`) and handling of uncommitted v5 changes on `main`.
