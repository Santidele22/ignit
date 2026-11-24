# Admin — Dashboard determinista

Feature: Dashboard /admin (modo determinista primero) — visualize in /admin the deterministic PDF firewall pipeline (Tier 0, Tier 1, Tier 2) per upload/book in near real time, and display the design/style reference the LLM uses to propose or apply style changes.
Branch: `feat/admin-dashboard-determinista`

## Specs

- **S1**: "Pipeline de seguridad en tiempo real: visualizar en /admin los tiers y chequeos del firewall determinista (Tier 0, Tier 1, Tier 2) por subida/libro." The firewall emits a structured per-tier pipeline report: each tier records every check it runs with `ran`/`passed`/`violation` status plus the violation `code` and `detail` when flagged, and `skipped` when an earlier tier rejected; existing rejection behavior (codes, Spanish 400 message, early exits) stays byte-for-byte identical.
- **S2**: The pipeline report is persisted at upload time, for accepted AND rejected uploads, as a `firewall.json` sidecar artifact through the existing JSON sidecar mechanism (`putJson` precedent, no database schema migration).
- **S3**: New admin endpoint `GET /admin/books/:id/firewall` (admin-only via the existing `@Roles(['admin'])` guard) returning the stored pipeline report for a book; `404` when no report exists (uploads before this feature, or books without a file).
- **S4**: The /admin queue renders the security pipeline per book: expanding a row loads and shows the three tiers with their checks, pass/violation states and machine codes; refreshing the queue reflects the latest uploads.
- **S5**: "Referencia de diseño del LLM: mostrar en /admin qué diseño/estilo de referencia toma el LLM para proponer o aplicar cambios de estilo." The editorial reference the LLM currently takes is materialized as one structured source (rubric 1–5, focus, inputs and limits) from which the analysis prompt is built AND from which a new admin endpoint `GET /admin/ai/style-reference` serves the same data; both always agree.
- **S6**: /admin shows a "Referencia de diseño del LLM" section rendering that structured reference (rubric levels verbatim, what the model sees, what it judges, what security is NOT its job).
- **S7**: Backend tests cover the per-tier report (order, statuses, skip behavior, unchanged rejection codes) and the two admin endpoints; web tests cover the new UI logic; `pnpm test && pnpm build` passes in backend and web.

## Tasks

- [x] T1 (S1) | inline | Structured per-tier pipeline report in `pdf-firewall.service.ts` (+ types), preserving rejection identity, with RED→GREEN spec tests | commit: `d1dbe69`
- [x] T2 (S2, S3) | inline | Persist `firewall.json` sidecar at upload (accepted + rejected) and admin `GET /admin/books/:id/firewall`, with tests | commit: `9af884c`
- [x] T3 (S5) | inline | Single-source editorial style reference module + admin `GET /admin/ai/style-reference`, with tests | commit: `74daf4b`
- [x] T4 (S4, S6, S7-web) | inline | /admin UI: pipeline detail view per book and LLM style-reference section, web tests | commit: `COMMIT
- [ ] T5 (S1–S7) | verify | Full verification: backend + web suites, builds, live check of /admin, Risk assessment | commit:

## Log

- **L1**: "empcemos esta issue: Dashboard /admin (modo determinista primero)
  1. Pipeline de seguridad en tiempo real: visualizar en /admin los tiers y chequeos del firewall determinista (Tier 0, Tier 1, Tier 2) por subida/libro.
  2. Referencia de diseño del LLM: mostrar en /admin qué diseño/estilo de referencia toma el LLM para proponer o aplicar cambios de estilo."
- **L2**: User decision "subi todos los cambios que hayan" → pre-existing uncommitted firewall hardening verified (254/254 backend tests) and pushed on `main` as commits `77946dc`, `4c690a1`, `ecce0d3`, `d8d6803` before starting this feature.
- **L3**: Technical decisions owned by the agent: persistence via JSON sidecar (no schema migration, consistent with prior feature decision "API actual sin migrar DB"); report captured inside the firewall service (same process as the verdict, no re-parse on demand — rejected uploads have no stored file to re-inspect).
