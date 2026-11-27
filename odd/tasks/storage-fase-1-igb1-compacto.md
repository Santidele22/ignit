# Storage & DRM — Fase 1: Formato Compacto `IGB1` (AES-256-GCM) y Fin de PDFs Crudos

Objetivo: eliminar la persistencia de PDFs/EPUBs originales, reducir el peso de cada libro de ~5–20 MB (PDF) / ~1.5 MB (`reading.json`) a ~120–180 KB mediante un formato binario compacto y comprimido (`IGB1`), e implementar encriptación estándar AES-256-GCM nativa en Backend (Node), Desktop (Rust), Mobile (Kotlin) y Web (`crypto.subtle`) sin UniFFI.
Índice maestro: `odd/tasks/local-first-storage-igb-drm.md` · Branch: `feat/storage-fase-1-igb1` (pendiente de crear al autorizar) · Entrega: commits por unidad de trabajo.
Test runners:
- Backend: `cd backend && pnpm test`
- Web: `cd web && pnpm test`
- Desktop (Rust): `cd apps/desktop/src-tauri && cargo test`
- Mobile (KMP): `cd apps/app && JAVA_HOME=/home/aegir/.bubblewrap/jdk/jdk-17.0.11+9 ./gradlew :core:domain:jvmTest :core:application:jvmTest :adapters:driven:persistence:jvmTest --no-daemon`

## Specs

- **S1 — Especificación binaria `IGB1` + compactación de payload**:
  - Layout binario fijo: `[magic: 4B "IGB1"] [version: 1B = 1] [flags: 1B] [nonce/IV: 12B] [ciphertext_or_payload: N bytes] [GCM tag: 16B si encrypted]`.
  - `flags`: bit 0 = compresión (`0 = gzip`, `1 = brotli`), bit 1 = encriptado (`0 = Tier 1 claro`, `1 = Tier 2/3 AES-256-GCM`), bit 2 = chunked por capítulo.
  - AAD obligatorio en AES-256-GCM: `${bookId}|${version}|${tier}` (UTF-8). Cualquier alteración de header, `bookId` o `tier` debe fallar la autenticación GCM.
  - Compactación previa a compresión: serializar `BookReadingDocument` omitiendo defaults (`mood === 'espera'`, `cues.length === 0`, `align === 'left'`) y excluyendo `aiRefinement.clutter` del artefacto servido al lector.
  - Checks: tests unitarios de round-trip (encode → decode), verificación de rechazo por tamper (header, AAD, tag, nonce) y benchmark confirmando reducción >80% respecto al `reading.json` crudo.

- **S2 — Modelo de 3 tiers en ingesta y fin de persistencia de PDFs/EPUBs crudos**:
  - Clasificar cada libro con `contentTier`: `public_open` (Tier 1), `private_user` (Tier 2) o `editorial_closed` (Tier 3) en `books`.
  - Durante `POST /books/:id/file`, extraer el texto/estructura en memoria/temp, generar `IGB1`, subir solo el `.igb` a Object Storage y **borrar el PDF/EPUB temporal inmediatamente** (nunca subir `.pdf`/`.epub` al bucket).
  - Tier 1 (`public_open`): clave de objeto deduplicada por `contentHash` (`books/public/<sha256>.igb`) con `Cache-Control: public, max-age=31536000, immutable`.
  - Tier 2 (`private_user`): encriptado con `DEK` única por libro/usuario (`books/private/<userId>/<bookId>.igb`), sin URL pública.
  - *Assumption*: se usa Neon Object Storage (S3) o Cloudflare R2 según decisión de infra del usuario antes de T2.
  - Checks: tests de `BooksService` y `S3BookStorage` verificando que `PutObject` solo recibe `.igb`, que Tier 1 deduplica por `contentHash` y que el archivo temporal se elimina en éxito y error.

- **S3 — Migración de libros existentes y limpieza de PDFs residuales**:
  - Script idempotente con modo `--dry-run` que convierte libros existentes (`reading.json` → `.igb`), actualiza `contentHash` y `contentTier` en `books`, verifica lectura post-migración y elimina los `.pdf`/`.epub` y `reading.json` legacy del bucket.
  - Checks: ejecución con `--dry-run` reportando ahorro estimado en MB/%, y test unitario del migrador sobre storage mockeado.

- **S4 — Compatibilidad cruzada nativa (Node, Rust, Kotlin, Web) sin UniFFI**:
  - Publicar un archivo compartido de **golden test vectors** (`docs/specs/igb1-golden-vectors.json` o equivalente) con casos Tier 1 (gzip/brotli claro), Tier 2/3 (AES-256-GCM + AAD) y casos inválidos (tag corrupto, AAD incorrecto).
  - Implementar encoder/decoder nativo usando únicamente crypto estándar de cada plataforma:
    - Backend: `node:crypto` + `node:zlib`
    - Desktop (Tauri): Rust `aes-gcm` + `flate2` (y `brotli`)
    - Mobile (KMP/Android): `javax.crypto.Cipher("AES/GCM/NoPadding")` + `java.util.zip`
    - Web: `crypto.subtle` (`AES-GCM`) + `DecompressionStream`
  - Checks: los 4 test suites pasan exactamente los mismos golden vectors byte a byte.

## Tasks

- T1 [S1] · `backend` · Especificación `IGB1`, compactador de `BookReadingDocument`, encoder/decoder Node (`gzip`/`brotli` + AES-256-GCM + AAD) y generación de golden test vectors (surfaces: `backend/src/books/reading/**`, `backend/src/books/igb/**`, `docs/specs/igb1-golden-vectors.json`) · status: done (5/5 tests in `igb1.spec.ts` + `nest build`)
- T2 [S2] · `backend` · Columna `contentTier` + `contentHash`, ingesta sin persistir PDFs/EPUBs crudos, deduplicación Tier 1 y cifrado Tier 2 en Object Storage (surfaces: `backend/src/books/entities/book.entity.ts`, `backend/src/books/storage/**`, `backend/src/books/books.service.ts`) · status: done (47/47 suites, 395 tests + `nest build`)
- T3 [S3] · `backend` + `scripts` · Script idempotente de migración (`--dry-run` y `--apply`) para convertir libros existentes a `.igb` y purgar PDFs crudos del bucket (surfaces: `scripts/**`, `backend/src/books/storage/**`) · status: in_progress
- T4 [S4] · `apps/desktop` + `apps/app` + `web` · Implementación nativa de decoder/encoder `IGB1` en Rust (`aes-gcm`), Kotlin (`javax.crypto`) y Web (`crypto.subtle`) validada contra los golden vectors sin UniFFI (surfaces: `apps/desktop/src-tauri/src/**`, `apps/app/core/**`, `apps/app/adapters/driven/**`, `web/src/features/library/lib/**`) · status: pending

## Log

- **L1 (2026-11-27, usuario, verbatim)**: «haz el odd de todas las fases» (desglose de `odd/tasks/local-first-storage-igb-drm.md`).
- **Contexto**: Derivado de L1–L2 del documento maestro (`odd/tasks/local-first-storage-igb-drm.md`): optimización para miles/millones de libros en free tier + AES-256-GCM estándar en ambos lados sin UniFFI.
