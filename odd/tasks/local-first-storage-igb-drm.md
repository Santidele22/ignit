# Ignit — Local-First Storage, Formato Compacto IGB1 (AES-256-GCM) y Protección Editorial estilo Kindle

Objetivo: migrar Desktop (Tauri/Rust) y Mobile (KMP/Android) a almacenamiento local-first con SQLite propio y sync completo (incluyendo libros privados) sin depender de Render para lectura diaria, optimizar el payload de lectura descartando PDFs crudos para escalar a miles/millones de libros en free tier, y proteger libros privados y de licencias cerradas con AES-256-GCM estándar (sin UniFFI) y DRM estilo Kindle.
Branch: `feat/local-first-storage-igb-drm` (pendiente de crear al autorizar implementación) · Estrategia de entrega: por fases en commits por unidad de trabajo (probable chained PR al superar ~400 líneas; consultar estrategia de PR antes de implementar).
Test runners:
- Backend: `cd backend && pnpm test`
- Web: `cd web && pnpm test`
- Desktop (Rust): `cd apps/desktop/src-tauri && cargo test`
- Mobile (KMP): `cd apps/app && JAVA_HOME=/home/aegir/.bubblewrap/jdk/jdk-17.0.11+9 ./gradlew :core:domain:jvmTest :core:application:jvmTest :adapters:driven:persistence:jvmTest :platforms:android:assembleDebug --no-daemon`
Relacionado: `odd/tasks/app-native-fase-4-offline-sync.md`, `odd/tasks/desktop-tauri-app.md`, `odd/tasks/etapa-1-legal-editoriales.md`.

## Fases (documentos ODD ejecutables)

Este documento actúa como **índice maestro y arquitectura global**. Cada fase tiene su propio ODD ejecutable con specs, tasks y checks granulares:

1. **Fase 1 — Formato compacto `IGB1`, AES-256-GCM estándar (sin UniFFI) y fin de PDFs crudos**: `odd/tasks/storage-fase-1-igb1-compacto.md` (`T1–T4`, status: pending)
2. **Fase 2 — Local-First SQLite (Desktop + Mobile), IndexedDB Web y Delta Sync completo**: `odd/tasks/storage-fase-2-local-first-sync.md` (`T1–T5`, status: pending)
3. **Fase 3 — Protección editorial anti-piratería estilo Kindle (`Tier 3`)**: `odd/tasks/storage-fase-3-drm-kindle-editoriales.md` (`T1–T5`, status: pending)

## Specs

- **S1 — Modelo de 3 tiers y fin de persistencia de PDFs crudos**:
  - Ningún tier persiste PDFs/EPUBs originales en Object Storage ni guarda texto/HTML en Postgres. El binario subido se extrae en memoria/temp y se descarta inmediatamente tras generar el payload compacto.
  - **Tier 1 (`public_open`)**: licencia abierta / dominio público → 1 sola copia global deduplicada por `contentHash` comprimida (Brotli/Gzip), servible desde Object Storage / CDN con caché inmutable (`Cache-Control: public, max-age=31536000, immutable`).
  - **Tier 2 (`private_user`)**: libros privados subidos por un usuario con **sync completo** entre PC, Mobile y Web → 1 copia comprimida y encriptada con AES-256-GCM por libro/usuario, sin URL pública ni distribución a terceros.
  - **Tier 3 (`editorial_closed`)**: libros de editoriales / licencia cerrada → 1 sola copia encriptada global por título (`CEK` única), cero exportación/descarga de archivo original, distribución bloqueada estilo Kindle.
  - *Assumption*: se mantiene Neon Object Storage (S3) inicialmente o se migra a Cloudflare R2 (10 GB gratis + egress $0) según decisión de infra antes de T2.
  - Checks: tests unitarios de `S3BookStorage` / `LocalBookStorage` y servicio de ingesta verificando que no se sube `.pdf`/`.epub` y que el tamaño comprimido reduce >80% vs `reading.json` crudo.

- **S2 — Formato binario estándar `IGB1` con AES-256-GCM nativo (sin UniFFI)**:
  - Header + envelope estándar compatible byte a byte entre **Backend (Node `node:crypto`)**, **Desktop (Rust `aes-gcm`)**, **Mobile (Kotlin `javax.crypto`)** y **Web (`crypto.subtle`)**:
    `[magic: 4B "IGB1"] [version: 1B = 1] [flags: 1B] [nonce/IV: 12B] [ciphertext: N bytes] [GCM tag: 16B]`
  - `flags`: bit 0 = compresión (`0 = gzip`, `1 = brotli`), bit 1 = encriptado (`0 = Tier 1 claro`, `1 = Tier 2/3 AES-256-GCM`), bit 2 = chunked por capítulo.
  - AAD (Additional Authenticated Data) obligatorio en GCM: `bookId|version|tier` para impedir sustitución de archivos o headers manipulados.
  - Payload interno optimizado: omitir campos default de `ReadingChunk` (`mood === 'espera'`, `cues === []`, `align === 'left'`) y excluir `aiRefinement.clutter` del artefacto de lectura (o usar HTML semántico mínimo + índice de capítulos).
  - Checks: suite de **vectores de prueba cruzados (golden test vectors)** generados en una plataforma y verificados idénticamente en Node, Rust (`cargo test`), Kotlin (`jvmTest`) y Web (`vitest`), incluyendo rechazo ante tamper de header/AAD/tag.

- **S3 — Base de datos local-first en Desktop (Tauri SQLite) y Mobile (KMP SQLite) + IndexedDB en Web**:
  - Esquema local equivalente en Desktop (`tauri-plugin-sql` / `rusqlite`) y Mobile (SQLDelight/Room): tablas `local_books`, `local_reading_states`, `local_licenses`, `sync_outbox`, `sync_meta` + almacenamiento de blobs `.igb` en disco local de la app.
  - Lectura, listado de biblioteca, avance de página, subrayados (`marks`) y vocabulario (`words`) operan 100% contra la DB local sin depender de Render ni de red.
  - Checks: tests unitarios de persistencia local en Rust y Kotlin verificando CRUD offline, lectura de `.igb` y persistencia de `sync_outbox`.

- **S4 — Protocolo de delta sync liviano (incluyendo libros privados)**:
  - Endpoints `POST /sync/push` y `POST /sync/pull` que intercambian únicamente deltas desde `lastSyncAt` (`books` metadata, `reading_states`, `licenses`, `deletedAt`) con resolución *Last-Write-Wins* por timestamp/entidad y reintento idempotente desde `sync_outbox`.
  - Libros privados (`Tier 2`): el cliente encripta/sube el `.igb` (~150 KB) vía URL prefirmada de subida y registra metadata en el sync; los demás dispositivos del mismo usuario bajan el `.igb` automáticamente en el próximo `pull`.
  - Postgres (Neon) guarda solo metadata liviana, estados de lectura, dispositivos y licencias (nunca texto/HTML).
  - Checks: tests de integración de `sync/push` + `sync/pull` (conflictos LWW, idempotencia, alta/borrado de libro privado entre dos dispositivos simulados).

- **S5 — Estrategia anti-piratería estilo Kindle para licencias cerradas (`Tier 3`)**:
  - Registro de dispositivos (`devices` table: `deviceId`, `userId`, `platform`, `publicKey`, `revokedAt`) con límite configurable por cuenta (ej. 5 dispositivos). Clave privada generada y custodiada en **Android Keystore (TEE)** en Mobile y **OS Keychain / Credential Manager** en Desktop.
  - Emisión de licencias (`licenses` table): `CEK` del libro envuelta (*key wrapping*) exclusivamente para la `publicKey` del `deviceId` autorizado + token firmado con expiración/revocación. Un `.igb` copiado a otro dispositivo es indescifrable.
  - Descifrado justo-a-tiempo por capítulo/bloque en RAM (sin volcar texto plano a disco).
  - Protecciones de lectura para Tier 3: bloquear descarga/exportación de PDF/archivo en API, `FLAG_SECURE` en Android para bloquear capturas/grabación, bloqueo de copia masiva en visor, watermark forense invisible ligado a `userId`, y en Web prohibir caché offline de Tier 3 en IndexedDB (solo streaming por capítulo autenticado).
  - Checks: tests de autorización/revocación de dispositivo, rechazo de `CEK` con clave de otro dispositivo, verificación de bloqueo de descarga en Tier 2/3 y verificación de `FLAG_SECURE` en visor Android para Tier 3.

## Tasks

- T1 [S1, S2] · `backend` · Especificación de formato compacto `IGB1` + encoder/decoder Node (`gzip`/`brotli` + AES-256-GCM + AAD) + golden test vectors + dejar de persistir PDFs/EPUBs crudos en ingesta (surfaces: `backend/src/books/reading/**`, `backend/src/books/storage/**`, `backend/src/books/books.service.ts`) · status: pending
- T2 [S1] · `backend` · Migración de libros existentes a formato compacto comprimido `IGB1` (Tier 1 deduplicado por `contentHash` / Tier 2 encriptado) + limpieza de PDFs residuales en Object Storage (surfaces: `backend/src/books/storage/**`, `scripts/**`) · status: pending
- T3 [S2] · `apps/desktop` + `apps/app` + `web` · Implementación nativa de decoder/encoder `IGB1` (AES-256-GCM + gzip/brotli) en Rust (`aes-gcm`), Kotlin (`javax.crypto`) y Web (`crypto.subtle`) validada contra los mismos golden vectors sin UniFFI (surfaces: `apps/desktop/src-tauri/src/**`, `apps/app/core/**`, `apps/app/adapters/driven/**`, `web/src/features/library/lib/**`) · status: pending
- T4 [S3] · `apps/desktop` · DB local SQLite en Tauri (`local_books`, `local_reading_states`, `local_licenses`, `sync_outbox`) + almacenamiento local de blobs `.igb` y puente con `web/` (surfaces: `apps/desktop/src-tauri/**`, `web/src/features/library/lib/**`) · status: pending
- T5 [S3] · `apps/app` · DB local SQLite en KMP/Android alineada al esquema de T4 + lectura offline de `.igb` (integrado con `odd/tasks/app-native-fase-4-offline-sync.md`) (surfaces: `apps/app/core/**`, `apps/app/adapters/driven/persistence/**`) · status: pending
- T6 [S4] · `backend` + clientes · Protocolo de delta sync `POST /sync/push` y `POST /sync/pull` + flujo de sync completo de libros privados (`Tier 2`) vía URLs prefirmadas (surfaces: `backend/src/sync/**`, `backend/src/books/**`, `apps/desktop/**`, `apps/app/**`, `web/src/features/library/**`) · status: pending
- T7 [S5] · `backend` · Registro de dispositivos (`devices`), licencias (`licenses`), *device-bound key wrapping* de `CEK`, límite/revocación de dispositivos y bloqueo estricto de descarga/distribución para Tier 2 y Tier 3 (surfaces: `backend/src/devices/**`, `backend/src/licenses/**`, `backend/src/books/**`) · status: pending
- T8 [S5] · `apps/desktop` + `apps/app` + `web` · Integración de Keychain/Android Keystore, descifrado por capítulo en RAM, `FLAG_SECURE` en Android, bloqueo de copia masiva, watermark forense invisible y política web sin caché offline para Tier 3 (surfaces: `apps/desktop/src-tauri/**`, `apps/app/platforms/android/**`, `apps/app/adapters/driving/**`, `web/src/features/book/reader/**`) · status: pending

## Log

- **L1 (2026-11-27, usuario, verbatim)**:
  > «quiero que repensemos la memoria tanto en aplicaciones moviles como en dekstop.
  > - porque?
  > Ahora tenemos un servidor gratuito con muchas limitaciones y una base de datos que se puede llenar muy rapido entonces pense en que tanto desktop como mobile deberian usar su propia base de datos local sin depender de un servicio como render. sin perder sincronizacion. 
  > despues como no estamos subiendo pdf a la web buscar una manera de optimizar el html cosa que cuando se suban miles, millones de libros no se sature ni la version gratuita»
- **L2 (2026-11-27, usuario, verbatim)**:
  > «Prefiero el sync completo de libros privados tambien.
  > una cosa tambien para ya solucionarlo desde hoy es el siguiente.ncriptación estándar y simple en ambos lados: No te compliques al principio compartiendo código Rust hacia Kotlin (vía UniFFI). Usá AES-256-GCM estándar: es nativo tanto en Rust (Tauri) como en Kotlin (javax.crypto), y te garantiza que un mismo libro encriptado se abre igual en PC y en celular.
  > y que no se pueda distribuir desde mi plataforma libros de licencias cerradas (cuando hagamos una alianza con alguna editorial tenemos que protegernos de la pirateria) usando la estrategia de kindle.»
- **L3 (2026-11-27, usuario, verbatim)**:
  > «Dale creemos el odd»
- **Análisis (2026-11-27)**: Relevo de arquitectura confirmó que hoy `backend/src/books/storage/s3-book.storage.ts` persiste PDFs/EPUBs crudos (hasta 50 MiB) y `reading.json` sin comprimir; Neon Postgres Free tiene ~512 MB; Render Free tiene 512 MB RAM y cold starts. El diseño de 3 tiers resuelve la tensión entre deduplicación global (Tier 1 público y Tier 3 editorial con 1 copia encriptada) y privacidad (Tier 2 privado encriptado por usuario), reduciendo cada libro promedio de ~5–20 MB (PDF) o ~1.5 MB (`reading.json`) a ~120–180 KB en `IGB1`.
- **Siguiente paso**: Confirmar si el storage de `.igb` sigue en Neon Object Storage o migra a Cloudflare R2 (10 GB gratis + egress $0), elegir estrategia de PR (chained PRs por fase) y autorizar el inicio de T1.
