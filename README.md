# Ignit

Visor inmersivo de lectura PDF (*modo Vigilia*), biblioteca multiusuario y gestión de progreso por lector.

Extraído de `personal-page` bajo estrategia **Strangler Fig** como proyecto totalmente independiente (base de datos propia, almacenamiento propio y despliegue autónomo).

## Arquitectura

- **`backend/`**: API REST en NestJS + TypeORM + Better Auth / Neon Auth (`PostgreSQL` en producción, `SQLite` en local/tests) + almacenamiento en Neon Object Storage en producción (bucket privado declarado en `backend/neon.ts`, sin R2 ni AWS S3 externos) o disco local en desarrollo para PDFs y sidecars de texto extraído (`reading.json`).
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
   El backend también carga `backend/.env.local` (con prioridad sobre `backend/.env`), por lo que podés usar cualquiera de los dos. Para trabajar 100% en local sobre SQLite (sin Neon ni Better Auth) con múltiples cuentas en `/registro` y `/login`, configurá `AUTH_MODE=dev`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `DEV_SESSION_SECRET` en `backend/.env` (o `backend/.env.local`).
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

## Checklist de despliegue independiente

Para mantener Ignit 100% aislado en base de datos, almacenamiento y despliegue:

1. **Cuentas**:
   - **GitHub** (tu cuenta actual `Santidele22`): repositorio `Santidele22/ignit`.
   - **`ignit677@gmail.com`**: cuentas dedicadas para **Neon** (proyecto `ignit`), **Render** (`ignit-api`) y **Cloudflare** (Workers `ignit-web`).
2. **Git & Remote**:
   ```bash
   git remote add origin git@github.com:Santidele22/ignit.git
   git push -u origin main
   ```
3. **Base de datos, Auth y Storage en Neon (`ignit677@gmail.com`)**:
   - Habilitar **Neon Auth** con registro público (email/contraseña) y copiar `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (directa), `NEON_AUTH_BASE_URL` y `NEON_AUTH_JWKS_URL`.
   - **Storage integrado en Neon (sin R2 ni AWS S3 externos)**: el bucket privado `books` se declara en `backend/neon.ts`; ejecutar `neon env pull` sobre la branch de producción para obtener `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` (con `BOOKS_STORAGE=s3` y `BOOKS_S3_BUCKET=books`).
   - Sincronizar tablas TypeORM (`users`, `books`, `reading_states`) una sola vez antes del primer arranque:
     ```bash
     cd backend && DB_MODE=prod DATABASE_URL="$DATABASE_URL_UNPOOLED" pnpm db:sync
     ```
   - Si alguna vez usás Better Auth self-hosted (`AUTH_MODE=better`), ejecutar también las migraciones de auth con `backend/src/auth/run-auth-migrations.ts`.
4. **Backend en Render (`ignit677@gmail.com`)**:
   - Conectar Blueprint `backend/render.yaml` desde `Santidele22/ignit`.
   - Completar las variables `sync: false`: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`, `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BETTER_AUTH_URL` (URL pública de Render) y `CORS_ORIGINS` (URL pública del Worker en Cloudflare).
5. **Frontend en Cloudflare Workers (`ignit677@gmail.com`)**:
   - Actualizar `web/wrangler.jsonc` (`BACKEND_URL`, `NEON_AUTH_BASE_URL`) y `web/astro.config.mjs` (`site` con la URL del Worker).
   - Ejecutar `cd web && pnpm deploy`.
