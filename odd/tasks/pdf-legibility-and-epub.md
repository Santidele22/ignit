# Feature: PDF Legibility Gate, pdfjs-dist Extractor, Rescue & Native EPUB Support

- **Objective**: Close the mojibake/broken-ToUnicode gap in PDF ingestion, add `pdfjs-dist` CMap-aware extraction + local OCR rescue script, and add full native EPUB support (`epub-firewall`, `reading.epub.ts`, storage/upload/UI).
- **Branch**: `feat/pdf-legibility-and-epub`
- **Delivery strategy**: `ask-on-risk` (work-unit commits on feature branch; ask before PR/push if >400 lines)
- **Test runner**: `cd backend && pnpm test`, `cd backend && pnpm lint`, `cd backend && pnpm build`, `cd web && pnpm test`, `cd web && pnpm astro check`

## Specs

- **S1 — Deterministic PDF/Reading Legibility Gate**: Reject extracted `BookReadingDocument`s whose non-whitespace text is mojibake/corrupted font glyphs (low Unicode letter ratio `< 0.35` or low alphabetic word ratio `< 0.20` when `totalNonWs >= 80`) in `attachBookFile` before persisting file/sidecars, returning a clear Spanish `400` error. Also allow `assessReadingLegibility` to be reused by rescue scripts and EPUB extraction.
- **S2 — CMap-aware `pdfjs-dist` Extractor**: Replace the raw regex `extractPagesFromPdfBuffer` primary fallback with `pdfjs-dist` (`getDocument` + `getTextContent`) so Node production without `poppler-utils` (Render) properly decodes `/ToUnicode` CMaps and font encodings.
- **S3 — Local OCR Rescue Script**: Provide `scripts/rescue-pdf-ocr.mjs` to scan local PDFs, detect broken `ToUnicode`/scanned files deterministically, and re-render them via `ocrmypdf` or `pdftoppm` + `tesseract` into clean searchable PDFs.
- **S4 — 3-Tier Deterministic EPUB Firewall (`epub-firewall`)**: Validate EPUB uploads deterministically: Tier 0 (ZIP magic bytes, `mimetype === "application/epub+zip"`, path traversal, entry/size/compression-ratio zip-bomb bounds), Tier 1 (`META-INF/container.xml`, reject DRM `META-INF/encryption.xml`), Tier 2 (block XXE, `<script>`, `<iframe>`, `<object>`, `on*=` handlers, `javascript:`/`file:` URIs in XHTML/XML/SVG/OPF). Emit `PdfFirewallReport`-compatible report for `/admin`.
- **S5 — Deterministic EPUB Extractor (`reading.epub.ts`) & Metadata**: Parse `container.xml` -> `content.opf` -> `<spine>` XHTML into `BookReadingDocument` (`heading`, `para` with `runs`, `quote`, `code`, `list`, `caption`, `toc`, synthetic `pdfPages`), pass `assessReadingLegibility`, and extract OPF metadata (`title`, `author`, `publisher`, `isbn`, `description`).
- **S6 — End-to-End EPUB Wiring (Backend + Web)**: Support `.epub` / `application/epub+zip` in `book-upload-config.ts`, `uploaded-pdf.ts`, `local-book.storage.ts`, `s3-book.storage.ts`, `book-file.ts`, `book-reading.ts`, `books-admin.service.ts`, and `web/` upload/validation components (`sala.ts`, `UploadBookModal.tsx`, `EditBookModal.tsx`, `BookFileUpload.tsx`).

## Tasks

| ID | Spec | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1 | inline | done | `reading.legibility.spec.ts` 5/5 + `ai-analysis.spec.ts` 11/11 |
| T2 | S2 | inline | done | `reading.pdfjs.spec.ts` 2/2, `reading/` 17/17, `nest build` clean |
| T3 | S3 | inline | done | `scripts/rescue-pdf-ocr.mjs` imports backend `assessTextLegibility` (Node 24 type-stripping); dry-run smoke: prose → OK, scanned → NEEDS_OCR:empty/scanned; `reading/` 17/17 |
| T4 | S4 | worker | done | `epub-firewall.spec.ts` 21/21 + `pdf-firewall.spec.ts` 69/69, oxlint clean, `nest build` exit 0 |
| T5 | S5 | inline | pending | pending |
| T6 | S6 | inline | pending | pending |

## Log

- **L1 (2026-11-25)**: User request: "Vamos a analizar esto y el porque cuando hicimos el script para subir libros permitimos esto por mas de tener un firewall de seguridad y un llm para el diseño + un metodo determinista." -> "Y como podemos scrapear esos pdf? y despues quiero tambien dar mantenimiento a los epub no solo pdf." -> "Dale me parece bien demosle a estas dos etapas" -> "ya podes continua".
- **L2 (2026-11-25)**: Root cause verified across `pdf-firewall.service.ts`, `reading.extract.ts`, `reading.pdf-text.ts`, `ai-refiner.prompt.ts`, `ai-analysis.service.ts`, `book-file.ts`, and `render.yaml`. Created branch `feat/pdf-legibility-and-epub`. Starting T1 (deterministic legibility gate).
- **L3 (2026-11-25)**: Session resumed. Reconciled: T1/T2 already committed (`a9d815a`, `67b1561`).
- **L4 (2026-11-25)**: T3 committed as `56ed317`: script reuses backend `assessTextLegibility` directly (Node 24 TS stripping), maps `!legible → NEEDS_OCR:mojibake/broken-ToUnicode`, `empty → NEEDS_OCR:empty/scanned` (backend treats empty as legible for `ocrPending`; the rescue script needs OCR on empty by definition), reports `replacementRatio`. Dry-run smoke: prose → OK, scanned → NEEDS_OCR. Local multipage fallback chain verified (ocrmypdf absent, tesseract present). T4 delegated to gentle-ai-worker (user requested subagent routing): removed parent-introduced module-level `currentBuffer`/`entryBytes()` indirection, threaded the pipeline Buffer explicitly through tiers 1/2 into `readEntryText`; single central-directory parse in tier 0; no mutable module state. RED→GREEN evidence: 13 failed / 77 passed → 90/90 across both firewall suites; oxlint clean; `nest build` exit 0. Commit 9dfe91f amended (broken-build slip) to fold the worker's fix into the T4 unit commit. Slice boundary: ~2050 authored lines across 4 commits since origin/main on the feature branch. Known gaps beyond original scope (Etapa 1 follow-up candidates): gate enforced at upload (`book-file.ts:70-74`) but NOT on lazy-serve (`book-reading.ts:32-48`) nor admin re-extract (`books-admin.service.ts:225-260`); no bulk mojibake report over stored `reading.json`.
