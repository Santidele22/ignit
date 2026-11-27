# Feature: Idempotent Reading Pipeline & Context-Aware LLM Refiner

- **Objective**: Consolidate PDF/EPUB extraction normalization into a single pure, idempotent, zone-aware backend normalizer (`frontmatter` / `toc` / `body` / `backmatter`) with golden archetype tests, and upgrade the LLM refiner with a global Book Blueprint, context windows (`prev`/`next` + head/tail), `split` & `flag_corrupt` ops, structured JSON outputs, and observability.
- **Branch**: `feat/idempotent-reading-pipeline-and-llm-refiner`
- **Delivery strategy**: `ask-on-risk` (work-unit commits on feature branch; expected >400 lines — ask delivery preference before starting implementation)
- **Test runner**: `pnpm --dir backend test`, `pnpm --dir backend lint`, `pnpm --dir backend build`, `pnpm --dir web test`, `pnpm --dir web astro check`

## Specs

- **S1 — Canonical Idempotent Normalizer & Zone State Machine (Backend)**:
  - Introduce a single pure normalizer (`normalizeReadingDocument(doc, bookMeta)`) in `backend/src/books/reading/` that classifies chunks into explicit document zones (`frontmatter` → `toc` → `body` → `backmatter`) and applies structural invariants (no dropcaps or code in `frontmatter`; uninterrupted `toc` context across column headers/subtitles; institution/credit/CC-icon cleanup; multi-entry/page-first TOC normalization; bump `READING_EXTRACTOR_VERSION` to `4`).
  - Property invariant: `normalizeReadingDocument(normalizeReadingDocument(doc))` must be deeply equal to `normalizeReadingDocument(doc)` (verified by unit property test).
  - Runs deterministically before `IGB1` packaging so Web, Desktop (Tauri), and Mobile (KMP) share identical canonical output.
- **S2 — Extractor Gaps (Python/Tech Code, EPUB CSS Semantics, Partial Font Corruption, Multi-column/Footnotes)**:
  - Add Python/pseudocode heuristics (`def`, `import`, `for ... in`, `while`, `print`) to `scoreCodeLine` / `reading.xml-blocks.ts`.
  - Map common editorial EPUB CSS classes and `epub:type` attributes (`credit`, `colophon`, `epigraph`, `dedication`, `verse`, `subtitle`) in `reading.epub.ts`.
  - Detect localized per-page/per-font `/ToUnicode` corruption (high rate of isolated single-letter spans like broken small-caps `D`, `P`, `S` or stripped code operators) and trigger selective fallback to `pdfjs-dist` (`extractPagesWithPdfJs`) or emit a structured corruption signal.
  - Guard `assemblePageLines` / `mergeCrossPageParagraphs` against 2-column interleaving and bottom-band footnotes.
- **S3 — Golden Archetype Fixtures & Thin Web Renderer**:
  - Add a golden fixture suite covering core book archetypes (editorial EPUB novel, classic short-chapter essay, technical book with code, small-caps/frontmatter PDF, poetry/dialogue) verifying both snapshot stability and idempotency.
  - Simplify `web/src/features/book/lib/displayItems.ts` so `extractorVersion >= 4` documents render directly from canonical chunks/zones while preserving backward compatibility for legacy `v1–v3` cached books.
- **S4 — LLM Book Blueprint (1-Call Global Context)**:
  - Add a lightweight single-call Blueprint step in `backend/src/books/ai/` (`title`, `author`, first ~40 chunks, TOC + heading samples) returning structured JSON: `{ genre, bodyStartChunkId, headingConvention, tocRange, qualityAlerts }`.
  - Feed the Blueprint into candidate selection and refinement prompts so fiction books never retain spurious `code`, `frontmatter → body` boundaries are globally consistent, and partial glyph corruption is surfaced to Admin.
- **S5 — LLM Context Windows, `split` & `flag_corrupt` Ops, Structured Outputs & Observability**:
  - Include read-only `prev`/`next` neighbor chunks around each candidate in `selectRefinerCandidateBatches`, and format long chunks with `head (160) … tail (80)` instead of truncating at 240 chars.
  - Extend `RefinerPatch` / `ai-refiner.parser.ts` with `split` (delimiter/index split without rewriting author prose) and `flag_corrupt` (non-destructive quality alert for Admin).
  - Enforce `response_format: { type: 'json_object' }` in `ai-refiner.service.ts`, skip Pass 2 when Pass 1 makes zero changes, and record structured telemetry in `aiRefinement` (`batchesTotal`, `batchesSucceeded`, `batchesFailed`, `rejectedBySafety`, `corruptFlags`).
- **S6 — Deterministic Batch Re-extraction Command**:
  - Provide an idempotent CLI/script to re-extract and re-normalize existing books with `extractorVersion < READING_EXTRACTOR_VERSION` (keyed by source hash + extractor version), with `--dry-run` support.

## Tasks

| ID | Spec | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1 | inline | done | `reading.normalizer.spec.ts` 2/2 (idempotency + zones), `reading.epub.spec.ts` 18/18, `book-reading.extractor.spec.ts` 12/12 |
| T2 | S2 | inline | done | `reading/` 5/5 suites (45/45 tests: Python code, EPUB CSS semantics, partial font corruption, footnote merge guard) |
| T3 | S3 | inline | done | `reading.golden-archetypes.spec.ts` 4/4 + `displayItems.test.ts` 9/9 |
| T4 | S4 | inline | done | `ai-blueprint.spec.ts` 2/2 (JSON blueprint + `response_format`) |
| T5 | S5 | inline | done | `ai-refiner.spec.ts` 10/10 (`split`, `flag_corrupt`, head+tail preview, Pass 2 short-circuit, `response_format`) |
| T6 | S6 | inline | done | `scripts/reextract-books.mjs` dry-run scanned 5/5 (`v3 -> v4`), `nest build` clean |

## Log

- **L1 (2026-11-27)**: User request: `"Bien pero para no seguir solucionando casos aislado como podemos mantener un diseño idempotente? que casos de usos nos falta corregir?"` → `"Bien me gusta y el llm que ya tenemos como podemos mejorarlo para que realmente sea util en su funcion?"` → `"Dale genera un odd para esta tarea juntando las dos mejoras."`
- **L2 (2026-11-27)**: Created feature document combining both tracks (idempotent canonical reading pipeline + upgraded context-aware LLM refiner). Prior quick fixes for dropcaps, narrow `I` spans, inline/page-first TOCs, and CC icon prefixes are already applied in working tree (`backend/src/books/reading/` + `web/src/features/book/lib/`, tests green: backend 50/50, web 353/353). Waiting for user confirmation on delivery strategy and go-ahead before creating branch and starting T1.
