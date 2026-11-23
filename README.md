# Ignit

Visor inmersivo de lectura PDF (*modo Vigilia*), biblioteca multiusuario y gestión de progreso por lector.

Extraído de `personal-page` bajo estrategia **Strangler Fig** como proyecto totalmente independiente (base de datos propia, almacenamiento propio y despliegue autónomo).

## Arquitectura

- **`backend/`**: API REST en NestJS + TypeORM + Better Auth / Neon Auth (`PostgreSQL` en producción, `SQLite` en local/tests) + almacenamiento S3/R2/B2 o disco local para PDFs y sidecars de texto extraído (`reading.json`).
- **`web/`**: Aplicación SSR en Astro 7.4 + islas SolidJS + Tailwind CSS v4 preparada para Cloudflare Workers.
  - `/` — Catálogo público de libros publicados (`published = true`) con filtro técnico / no técnico y paginación.
  - `/lecturas/[id]` — Lector inmersivo *Vigilia* (autenticado con sincronización en la nube por usuario, o anónimo local con `localStorage` para libros publicados).
  - `/biblioteca` — Biblioteca personal de cada usuario autenticado (`GET /books?mine=true`), creación de libros, subida de PDF y control de publicación.
  - `/login` y `/registro` — Acceso y registro público multiusuario (`disableSignUp: false`).
  - `/api/[...path]` — Proxy same-origin con límite de 60 MiB para subidas de PDFs (`POST /api/books/:id/file`).

## Desarrollo local

1. Copiar archivos de entorno de ejemplo:
   ```bash
   cp backend/.env.example backend/.env
   cp web/.env.example web/.env
   ```
2. Instalar dependencias:
   ```bash
   cd backend && pnpm install
   cd ../web && pnpm install
   ```
3. Iniciar ambos servicios en modo SQLite sin Docker:
   ```bash
   ./scripts/dev.sh --no-docker
   ```
   O con PostgreSQL local:
   ```bash
   ./scripts/dev.sh
   ```

## Tests y build

```bash
cd backend && pnpm test && pnpm build
cd ../web && pnpm test && pnpm build
```

## Checklist de despliegue independiente (`ignit2026@gmail.com`)

Para mantener Ignit 100% aislado de otros proyectos (cuotas free-tier separadas, credenciales propias y dominio propio):

1. **Cuenta de proyecto**: Crear o usar `ignit2026@gmail.com` para:
   - GitHub (repositorio `ignit`)
   - Neon (proyecto `ignit`, base Postgres + Neon Auth con registro público habilitado)
   - Render (Web Service `ignit-api` con `backend/render.yaml`)
   - Cloudflare (Workers `ignit-web` con `web/wrangler.jsonc` + KV opcional / R2 bucket `ignit-books`)
2. **Git & Remote**:
   ```bash
   git remote add origin git@github.com:<org-o-usuario>/ignit.git
   git push -u origin main
   ```
3. **Base de datos y Auth (Neon)**:
   - Habilitar **Neon Auth** con sign-up por email/contraseña habilitado.
   - Copiar `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (directa), `NEON_AUTH_BASE_URL` y `NEON_AUTH_JWKS_URL`.
   - Si usás Better Auth self-hosted (`AUTH_MODE=better`), ejecutar las migraciones de auth con `backend/src/auth/run-auth-migrations.ts` y sincronizar esquema TypeORM en el primer despliegue.
4. **Object Storage (R2 / B2 / Neon Object Storage)**:
   - Crear bucket `ignit-books` y configurar `BOOKS_STORAGE=s3`, `BOOKS_S3_BUCKET=ignit-books`, `AWS_REGION`, `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
5. **Backend (Render)**:
   - Conectar Blueprint `backend/render.yaml`.
   - Completar secretos `sync: false`: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`, `AWS_*`, `BETTER_AUTH_URL` (URL pública de Render) y `CORS_ORIGINS` (URL pública del Worker en Cloudflare).
6. **Frontend (Cloudflare Workers)**:
   - Actualizar `web/wrangler.jsonc` (`BACKEND_URL`, `NEON_AUTH_BASE_URL`) y `web/astro.config.mjs` (`site` y `PUBLIC_API_BASE_URL` si aplica).
   - Ejecutar `cd web && pnpm deploy`.
