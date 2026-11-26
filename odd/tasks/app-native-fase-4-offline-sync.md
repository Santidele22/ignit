# App nativa Ignit — Fase 4: Offline y sync real

Objetivo: permitir descargar libros completos al almacenamiento del dispositivo para leer sin conexión, encolar cambios de progreso con reintento ante fallos de red y resolver conflictos web ↔ app (last-write-wins por timestamp más reciente).
Dependencia previa: `odd/tasks/app-native-fase-3-lector.md` completada.
Test runner: `cd apps/app && JAVA_HOME=/home/aegir/.bubblewrap/jdk/jdk-17.0.11+9 ./gradlew :core:domain:jvmTest :core:application:jvmTest :adapters:driven:persistence:jvmTest :platforms:desktop:compileKotlinJvm :platforms:android:assembleDebug --no-daemon`

## Specs

- S1 (T1): `core/domain` y `core/application` — regla pura de resolución de conflictos (`resolveProgressConflict(local, remote)` → gana el de `updatedAtEpochMs` más reciente), puerto `OfflineBookStore` y cola de sincronización (`SyncQueue` / `SyncPendingProgress` con reintento idempotente). Checks: tests unitarios cubriendo conflicto local vs remoto y cola vacía/reintentos.
- S2 (T2): `adapters/driven/persistence` + `http-api` — descarga y almacenamiento local de libro completo (`GET /api/books/:id/reading` y/o `/download` en SQLDelight/archivos del dispositivo) + tabla `sync_queue` para operaciones de progreso pendientes cuando no hay red.
- S3 (T3): `adapters/driving/ui-compose` — indicador de libro disponible offline, botón "Descargar para leer sin conexión" / eliminar descarga, indicador de estado de sincronización (pendiente vs sincronizado) y lectura sin red en `ReaderScreen`.
- S4 (T4): `platforms/*` + `docs` — prueba en vivo en `ignit_pixel` activando modo avión (descargar libro → cortar red → avanzar páginas → reconectar → verificar sync con el servidor), `apps/app/docs/fase-4.md` y check en `apps/app/ROADMAP.md`.

## Tasks

- T1 [S1] · `core/domain` + `core/application` · `resolveProgressConflict`, `OfflineBookStore` port y `SyncPendingProgress` + tests TDD (surfaces: `apps/app/core/domain/**`, `apps/app/core/application/**`) · status: pending
- T2 [S2] · `adapters/driven/persistence` + `http-api` · persistencia offline de libros + `sync_queue` con reintento (surfaces: `apps/app/adapters/driven/persistence/**`, `apps/app/adapters/driven/http-api/**`) · status: pending
- T3 [S3] · `adapters/driving/ui-compose` · UX de descarga offline y estado de sync en `LibraryScreen` y `ReaderScreen` (surfaces: `apps/app/adapters/driving/ui-compose/**`) · status: pending
- T4 [S4] · `platforms/*` + `docs` · prueba en vivo modo avión en `ignit_pixel`, `apps/app/docs/fase-4.md` y update `apps/app/ROADMAP.md` (surfaces: `apps/app/platforms/**`, `apps/app/docs/fase-4.md`, `apps/app/ROADMAP.md`) · status: pending

## Log

- L1 (usuario, verbatim): «Mientras el agente realiza las tareas de odd vayamos planeando las demas tareas.»
