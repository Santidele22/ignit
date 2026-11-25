# Etapa 1: Legalización gradual y preparación para editoriales/difusión

- **Objective**: Preparar Ignit para colaborar con editoriales chicas, autores, influencers y youtubers: ficha editorial completa + botón CTA externo, bloqueo de descarga directa del PDF fuente, despublicación inmediata desde el panel admin, y contadores básicos de métricas por libro.
- **Branch**: `main` (workspace actual sin commitear hasta revisión final, respetando cambios locales existentes)
- **Test runners**: Backend `cd backend && pnpm test && pnpm lint && pnpm build` | Web `cd web && pnpm test && pnpm astro check && pnpm build`

## Specs

- **S1 — Ficha del libro + botón CTA externo**:
  - Campos nuevos opcionales en `Book` (`books` table, nullable `text`/`varchar`): `publisher` (editorial), `translator` (traductor), `illustrator` (ilustrador), `isbn` (ISBN), `license` (licencia), `ctaLabel` (texto del botón CTA externo, ej. "Comprar libro físico", "Apoyar en Cafecito/Bancantes"), `ctaUrl` (URL externa validada `http://` o `https://`).
  - Aceptados en `POST /books`, `PATCH /books/:id`, devueltos en `presentBook` y en `presentAdminBook`.
  - En UI:
    - Formularios de carga (`UploadBookModal`) y edición (`EditBookModal` y `BookFields`) permiten cargar y editar estos campos.
    - Modal de ficha editorial accesible desde las cards de `/biblioteca` (sin romper el click directo al lector `/lecturas/:id`) y también visible en `/lecturas/:id` (Vigilia) junto al botón CTA externo cuando `ctaUrl` está presente.
  - Checks: tests unitarios de DTO/service/presenter + tests de componentes/helper en web.

- **S2 — Protección de archivos (evitar descarga directa del PDF fuente)**:
  - `GET /books/:id/download` queda restringido exclusivamente a usuarios con rol `admin` (`403 Forbidden` para lectores autenticados no-admin o anónimos; `401`/`403` según guard/access).
  - `books.controller.ts` usa el `respondWithDownload` endurecido (`http/download-response.ts`: `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`).
  - En el lector Vigilia (`web/src/widgets/reading/loadReading.ts`), el fallback OCR NO muestra `<iframe src="/api/books/:id/download">` ni `<a href="/api/books/:id/download">descargar el PDF original</a>`; muestra un mensaje claro indicando que el libro todavía no tiene texto procesado para lectura.
  - La lectura normal y la descarga offline continúan funcionando con el documento JSON extraído (`GET /books/:id/reading`).
  - Checks: tests de acceso en `books.access.spec.ts` / `books.service.spec.ts` + tests en `web`.

- **S3 — Gestión de catálogo (despublicar inmediato en panel admin)**:
  - `GET /admin/books` soporta filtrar por publicados (`?published=true|false`) además de `?review=pending|approved|rejected`, para poder listar el catálogo publicado en el panel admin.
  - Nuevo endpoint admin `POST /admin/books/:id/unpublish` (y/o `publish`) protegido con `@Roles(['admin'])` que cambia `published = false` inmediatamente (y opcionalmente registra `reviewNote` si se pasa motivo) devolviendo el `AdminBookView` actualizado.
  - El proxy Astro (`web/src/pages/api/[...path].ts`) invalida `CONTENT_CACHE` ante `POST /api/admin/books/:id/unpublish` (y mutaciones admin) para que el retiro sea inmediato incluso en el borde de Cloudflare.
  - En `/admin`, nueva pestaña/vista **Catálogo publicado** (junto a la cola de revisión pendiente) con botón **"Despublicar"** inmediato por libro.
  - Checks: tests en `books-admin.service.spec.ts`, `books-admin.controller.spec.ts`, `[...path].test.ts` y tests del panel admin en `web`.

- **S4 — Métricas básicas por libro**:
  - Contadores atómicos por libro en `books`: `readsStartedCount` (`int`, default `0`), `offlineDownloadsCount` (`int`, default `0`), `ctaClicksCount` (`int`, default `0`).
  - Nuevo endpoint `POST /books/:id/metrics` (`@AllowAnonymous()`, verifica `assertCanReadBook`) que recibe `{ event: 'read_started' | 'offline_download' | 'cta_click' }` e incrementa atómicamente el contador correspondiente (`booksRepository.increment`).
  - Disparo desde frontend (no bloqueante, `keepalive: true`):
    1. `read_started`: al abrir/cargar un libro en Vigilia (`loadReading.ts`, deduplicado por sesión vía `sessionStorage`).
    2. `offline_download`: al guardar un libro offline en `BibliotecaApp.tsx` (solo al descargar, no al quitar).
    3. `cta_click`: al hacer clic en el botón CTA externo (en modal de ficha y en Vigilia).
  - Visibilidad: los 3 contadores se exponen en `AdminBookView` y se muestran por libro en el panel admin (vista de catálogo publicado).
  - Checks: tests de incremento atómico y validación en backend + tests de tracking/UI en web.

## Tasks

- [x] **T1** (`S1`): Backend — Campos de ficha del libro + CTA externo en entidad, DTOs, `book-presenter`, `book-review` y tests | route: inline | status: `done` (38 test files / 297 tests passed, oxlint 0 errors, nest build ok)
- [x] **T2** (`S2`, `S3`, `S4`): Backend — Bloqueo admin-only de `/books/:id/download`, `GET /admin/books?published=...` + `POST /admin/books/:id/unpublish`, contadores de métricas + `POST /books/:id/metrics`, y tests | route: inline | status: `done` (38 test files / 297 tests passed, oxlint 0 errors, nest build ok)
- [x] **T3** (`S1`, `S2`, `S4`): Frontend — Tipos, `UploadBookModal`, `EditBookModal`, `BookFields`, modal de ficha del libro + CTA en `/biblioteca` y Vigilia (`/lecturas/:id`), quitar descarga directa en fallback OCR, tracking de las 3 métricas y tests | route: inline | status: `done`
- [x] **T4** (`S3`, `S4`): Frontend — Panel Admin: vista de catálogo publicado con botón "Despublicar" inmediato + contadores de métricas por libro + invalidación de `CONTENT_CACHE` en `[...path].ts` y tests | route: inline | status: `done`
- [x] **T5** (`S1..S4`): Verificación completa (suites backend unit + e2e + lint + build; web unit + astro check + build) + auditoría independiente read-only (`pro`) + remediación de hallazgos | route: verifier | status: `done`

## Log

- **L1** (2026-11-25): Solicitud original del usuario: «Vamos con estos pasos para llevar este proyecto a lo legal de a poco y empezar a comunicarnos con editoriales chiquitas, influencers, youtubers, etc.» + imagen tabla "Etapa 1: Libros gratuitos y difusión (ahora)": Ficha del libro (editorial, autor, traductor, ilustrador, ISBN, licencia, botón CTA externo), Protección de archivos (evitar descarga directa PDF/EPUB), Gestión de catálogo (botón despublicar inmediato en panel admin), Métricas (lecturas iniciadas, descargas offline, clics en enlace a tienda).
- **L2** (2026-11-25): Decisiones confirmadas por el usuario: (A1) Modal de ficha desde las cards + info/CTA visible dentro del lector Vigilia; (A2) Solo admins pueden acceder a `/books/:id/download` (403 a lectores) y quitar link/iframe al PDF original en Vigilia; (A3) Trabajar en workspace actual sin commitear todavía, respetando cambios locales existentes en `main`.
- **L3** (2026-11-25): Auditoría independiente (`pro`) detectó 4 hallazgos reales que fueron corregidos y re-verificados en verde: (1) sanitización `safeExternalUrl` (`http:`/`https:`) en todos los puntos de renderizado de `ctaUrl` en frontend; (2) actualización de tests E2E (`books.e2e-spec.ts` y `books-s3.e2e-spec.ts`) al nuevo contrato admin-only de `/books/:id/download`; (3) cierre de bypass de re-publicación tras retiro administrativo (`applyUnpublish` fija `reviewStatus = 'rejected'` y `updateForUser` bloquea con `403` que un no-admin vuelva a poner `published: true`); (4) tests agregados para invalidación de `CONTENT_CACHE`, filtro `published`, `presentBook` y `safeExternalUrl`. Suites finales: backend unit `38/38` + e2e + lint `0 errors` + build; web `44/44` (`282 tests`) + `astro check` `0 errors` + build.
