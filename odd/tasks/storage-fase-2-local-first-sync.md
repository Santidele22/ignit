# Storage & DRM — Fase 2: Local-First SQLite (Desktop + Mobile), IndexedDB Web y Delta Sync Completo

Objetivo: que Desktop (Tauri) y Mobile (KMP/Android) usen su propia base de datos SQLite local y disco local para `.igb` sin depender de Render para abrir la app o leer, manteniendo sincronización completa (estado + biblioteca + libros privados Tier 2) entre PC, celular y web mediante un protocolo liviano de deltas.
Índice maestro: `odd/tasks/local-first-storage-igb-drm.md` · Dependencia previa: `odd/tasks/storage-fase-1-igb1-compacto.md` · Relacionado: `odd/tasks/app-native-fase-4-offline-sync.md`.
Branch: `feat/storage-fase-2-local-first-sync` (pendiente de crear al autorizar) · Entrega: commits por unidad de trabajo.
Test runners:
- Backend: `cd backend && pnpm test`
- Web: `cd web && pnpm test`
- Desktop (Rust): `cd apps/desktop/src-tauri && cargo test`
- Mobile (KMP): `cd apps/app && JAVA_HOME=/home/aegir/.bubblewrap/jdk/jdk-17.0.11+9 ./gradlew :core:domain:jvmTest :core:application:jvmTest :adapters:driven:persistence:jvmTest :platforms:android:assembleDebug --no-daemon`

## Specs

- **S1 — Esquema SQLite local unificado para Desktop y Mobile**:
  - Ambas apps comparten el mismo modelo lógico de tablas locales:
    - `local_books` (`id`, `remote_id`, `content_hash`, `content_tier`, `title`, `author`, `kind`, `status`, `igb_local_path`, `igb_bytes`, `updated_at`, `deleted_at`)
    - `local_reading_states` (`book_id`, `page`, `pct`, `chunk_id`, `marks_json`, `words_json`, `updated_at`)
    - `local_licenses` (`book_id`, `device_id`, `wrapped_key`, `expires_at`, `revoked_at`)
    - `sync_outbox` (`id`, `entity_type`, `entity_id`, `op`, `payload_json`, `created_at`, `retry_count`, `last_error`)
    - `sync_meta` (`key`, `value` — ej. `last_sync_at`, `device_id`)
  - Todos los flujos de lectura (listar biblioteca, abrir libro, avanzar página, subrayar, guardar palabras) leen y escriben primero en SQLite + `.igb` local (latencia 0, 100% offline, 0 pegadas a Render).
  - Checks: tests unitarios de migración y CRUD offline en Rust (`apps/desktop/src-tauri`) y Kotlin (`apps/app`).

- **S2 — Desktop (Tauri v2): SQLite nativo + almacén local de `.igb`**:
  - Integrar SQLite nativo en `apps/desktop/src-tauri` (`tauri-plugin-sql` o `rusqlite`) y directorio `app_data_dir/books/<hash>.igb`.
  - Exponer comandos Tauri para que la UI (`web/` corriendo dentro de Tauri) consuma el almacenamiento local cuando está en modo Desktop, con fallback transparente a IndexedDB cuando corre en navegador.
  - Checks: `cargo test` cubriendo CRUD SQLite + lectura/escritura `.igb` + enqueue en `sync_outbox`.

- **S3 — Mobile (KMP/Android): SQLite local + lectura offline `.igb`**:
  - Implementar el esquema de S1 en `apps/app/adapters/driven/persistence` (SQLDelight/Room), integrándolo con `resolveProgressConflict` y `SyncQueue` de `odd/tasks/app-native-fase-4-offline-sync.md`.
  - Descargar y abrir blobs `.igb` desde internal storage de Android usando el decoder `IGB1` de Fase 1.
  - Checks: tests JVM de persistencia + build Android debug (`:platforms:android:assembleDebug`).

- **S4 — Web: evolución de IndexedDB (`offlineStore.ts`) a `IGB1` + `sync_outbox`**:
  - Migrar [offlineStore.ts](file:///home/aegir/ignit/web/src/features/library/lib/offlineStore.ts) (`ignit-offline-v2`) para guardar blobs `.igb` compactos en lugar de `BookReadingDocument` crudo (reducción ~10x en cuota del navegador) y mantener una cola `sync_outbox` para progreso/marcas offline.
  - Respetar desde ya la regla de no persistir `Tier 3` (`editorial_closed`) en IndexedDB.
  - Checks: tests unitarios de `offlineStore` con migración v1 → v2, enqueue offline y rechazo de caché offline para Tier 3.

- **S5 — Protocolo de delta sync (`POST /sync/push` y `POST /sync/pull`) + sync completo de libros privados (`Tier 2`)**:
  - `POST /sync/push`: recibe lote idempotente de eventos del `sync_outbox` (metadata de libros, `reading_states`, borrados con `deletedAt`), resuelve conflictos por *Last-Write-Wins* (`updatedAt`) y devuelve acks + URLs prefirmadas de subida para nuevos `.igb` privados (`Tier 2`).
  - `POST /sync/pull`: recibe `since` (`lastSyncAt`) y devuelve solo deltas cambiados (metadata, estados, licencias y URLs prefirmadas de descarga para `.igb` nuevos o actualizados).
  - Neon Postgres guarda solo metadata liviana y deltas de estado (~1–3 KB por libro); nunca contenido del libro.
  - *Nota futura*: el módulo `sync` se diseña desacoplado de NestJS/Render para poder moverse a Cloudflare Workers + D1/Neon si Render Free muestra cold starts molestos.
  - Checks: tests de integración backend simulando 2 dispositivos (Desktop + Mobile): subida de libro privado en A → sync → descarga y lectura en B; avance offline concurrente en A y B → LWW determinista; borrado en A → tombstone propagado a B.

## Tasks

- T1 [S1, S2] · `apps/desktop` · Esquema SQLite nativo en Tauri (`local_books`, `local_reading_states`, `local_licenses`, `sync_outbox`, `sync_meta`) + almacenamiento de blobs `.igb` + comandos Tauri y tests Rust (surfaces: `apps/desktop/src-tauri/**`) · status: done (`cargo test --offline` 9/9)
- T2 [S1, S3] · `apps/app` · Esquema SQLite local en KMP/Android alineado a S1 + lectura offline `.igb` + `sync_outbox` integrado con Fase 4 móvil (surfaces: `apps/app/core/**`, `apps/app/adapters/driven/persistence/**`) · status: done (`jvmTest` + `compileDebugKotlinAndroid` BUILD SUCCESSFUL)
- T3 [S4] · `web` · Evolución de `offlineStore.ts` a IndexedDB v2 con blobs `.igb`, `sync_outbox` y bloqueo de caché offline para Tier 3 (surfaces: `web/src/features/library/lib/**`) · status: done (`vitest` 52/52 files, 343 tests)
- T4 [S5] · `backend` · Módulo `sync` (`POST /sync/push`, `POST /sync/pull`, LWW, tombstones `deletedAt`, presigned upload/download para libros privados Tier 2) + tests de integración multi-dispositivo (surfaces: `backend/src/sync/**`, `backend/src/books/**`) · status: in_progress
- T5 [S2, S3, S4, S5] · `apps/desktop` + `apps/app` + `web` · Conexión de los 3 clientes al delta sync con worker/cola de reintentos y prueba E2E de convergencia offline (Desktop ↔ Mobile ↔ Web) (surfaces: `apps/desktop/**`, `apps/app/adapters/driven/http-api/**`, `web/src/features/library/**`, `web/src/features/book/**`) · status: pending

## Log

- **L1 (2026-11-27, usuario, verbatim)**: «haz el odd de todas las fases» (desglose de `odd/tasks/local-first-storage-igb-drm.md`).
- **Contexto**: Resuelve el requerimiento de base de datos local en Desktop y Mobile sin depender de Render + sync completo de libros privados.
