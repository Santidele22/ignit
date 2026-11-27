# Fase 3 — Lector nativo (HorizontalPager + SQLite + IGB1)

## Qué se construyó
- **Dominio & Aplicación**: `ReadingProgress`, `DomainReadingDocument`, `resolveProgressConflict`, `ReadingContentGateway` y casos de uso `OpenBookReading`, `SaveReadingProgress` y `SyncReadingProgress`.
- **Persistencia local**: `LocalProgressRepository` respaldado por `IgnitLocalStore` (SQLite en Android) y `IgbBlobStore` (documentos cacheados comprimidos con `IGB1`).
- **Red**: `KtorReadingGateway` contra `GET /api/books/{id}/reading` y `GET/PUT /api/books/{id}/reading-state` con sesión autenticada por cookie/bearer.
- **UI Compose**: `ReaderViewModel` y `ReaderScreen` con `HorizontalPager`, modo **Vigilia / Día**, ficha del libro, barra de progreso e indicador de sincronización.

## Aprendizaje
- Mantener la resolución LWW (`resolveProgressConflict`) en `core/domain` permite probarla en milisegundos sin emulador Android ni SQLite real.
- `HorizontalPager` + `snapshotFlow { pagerState.currentPage + 1 }.distinctUntilChanged()` evita guardar en disco en cada recomposición y persiste exactamente al cambiar de página.
