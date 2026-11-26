# App nativa Ignit — Fase 3: Lector (el corazón de Ignit)

Objetivo: construir el lector nativo paginado en Compose (`HorizontalPager`), descargando el documento extraído desde `GET /api/books/:id/reading`, persistiendo el progreso localmente con SQLDelight y sincronizando con `GET/PUT /api/books/:id/reading-state`.
Dependencia previa: `odd/tasks/app-native-fase-2-biblioteca.md` completada.
Test runner: `cd apps/app && JAVA_HOME=/home/aegir/.bubblewrap/jdk/jdk-17.0.11+9 ./gradlew :core:domain:jvmTest :core:application:jvmTest :adapters:driven:persistence:jvmTest :platforms:desktop:compileKotlinJvm :platforms:android:assembleDebug --no-daemon`

## Specs

- S1 (T1): `core/domain` y `core/application` — modelos `ReadingProgress(bookId, page, chapter, updatedAtEpochMs)`, `ReadingChunk` / `ReadingDocument(bookId, pdfPages, chunks)` en `core/domain`; puerto `ReadingContentGateway` (`fetchReading(bookId)`) y ampliación de `ProgressRepository` (`getLocal`, `saveLocally`, `syncPending`); casos de uso `OpenBookReading`, `SaveReadingProgress` y `SyncReadingProgress` con tests unitarios (TDD).
- S2 (T2): `adapters/driven/persistence` — habilitar plugin `sqldelight` (`IgnitLocal.sq`), crear tablas `reading_progress` y `reading_document_cache`, drivers Android (`AndroidSqliteDriver`) y Desktop JVM (`JdbcSqliteDriver`), reemplazando el stub `LocalProgressRepository` por persistencia real. Checks: `:adapters:driven:persistence:jvmTest` (con SQLite in-memory).
- S3 (T3): `adapters/driven/http-api` — `KtorReadingGateway` llamando `GET {baseUrl}/api/books/{id}/reading`, `GET {baseUrl}/api/books/{id}/reading-state` y `PUT {baseUrl}/api/books/{id}/reading-state` con sesión autenticada.
- S4 (T4): `adapters/driving/ui-compose` — `ReaderViewModel` y `ReaderScreen`: `HorizontalPager` paginado por chunks/páginas, modo Vigilia (paleta oscura de lectura nocturna / tema cálido), barra de progreso + ficha del libro, guardado automático al cambiar de página y navegación `Biblioteca ⇒ Lector`.
- S5 (T5): `platforms/*` + `docs` — wiring de SQLDelight drivers y `ReaderScreen`, prueba en vivo abriendo un libro en `ignit_pixel` y verificando persistencia tras cerrar/reabrir la app, `apps/app/docs/fase-3.md` (`## Aprendizaje` sobre SQLDelight y Pager) y check en `apps/app/ROADMAP.md`.

## Tasks

- T1 [S1] · `core/domain` + `core/application` · modelos `ReadingProgress`/`ReadingDocument`, puertos y casos de uso del lector + tests (surfaces: `apps/app/core/domain/**`, `apps/app/core/application/**`) · status: pending
- T2 [S2] · `adapters/driven/persistence` · schema SQLDelight `IgnitLocal`, drivers Android/JVM y `SqlDelightProgressRepository` + tests (surfaces: `apps/app/adapters/driven/persistence/**`, `apps/app/build.gradle.kts`) · status: pending
- T3 [S3] · `adapters/driven/http-api` · `KtorReadingGateway` (`GET /reading`, `GET/PUT /reading-state`) + tests `MockEngine` (surfaces: `apps/app/adapters/driven/http-api/**`) · status: pending
- T4 [S4] · `adapters/driving/ui-compose` · `ReaderViewModel`, `ReaderScreen` (`HorizontalPager`, modo Vigilia, ficha) y navegación Biblioteca ⇒ Lector (surfaces: `apps/app/adapters/driving/ui-compose/**`) · status: pending
- T5 [S5] · `platforms/*` + `docs` · wiring de drivers, verificación en vivo en `ignit_pixel`, `apps/app/docs/fase-3.md` y update `apps/app/ROADMAP.md` (surfaces: `apps/app/platforms/**`, `apps/app/docs/fase-3.md`, `apps/app/ROADMAP.md`) · status: pending

## Log

- L1 (usuario, verbatim): «Mientras el agente realiza las tareas de odd vayamos planeando las demas tareas.»
- L2 (exploración backend): `backend/src/books/books.controller.ts` expone `GET /books/:id/reading` (`{ bookId, pdfPages, ocrPending, chunks[] }`), `GET /books/:id/reading-state` y `PUT /books/:id/reading-state`.
