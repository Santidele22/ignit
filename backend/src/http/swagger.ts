import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';

export function isSwaggerEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.SWAGGER_ENABLED === 'false') {
    return false;
  }
  if (env.NODE_ENV === 'production') {
    return env.SWAGGER_ENABLED === 'true';
  }
  return true;
}

export function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('Ignit API')
    .setVersion('1.0.0')
    .setDescription(
      [
        'REST API for Ignit — multi-user PDF library, extraction pipeline, and immersive Vigilia reader.',
        '',
        '### Servers & Proxy',
        '- Direct backend requests (local dev on `http://localhost:3000` or Render) hit root paths such as `/books`, `/health-db`.',
        '- Browser requests through the Astro/Worker proxy use the `/api` prefix, which strips `/api` before forwarding (except `/api/auth/*`, which keeps `/api/auth/*`).',
        '',
        '### Authentication (`AUTH_MODE`)',
        '- **neon** (production): send `Authorization: Bearer <JWT>` verified against Neon Auth JWKS.',
        '- **better**: Better Auth mounts `/api/auth/*` (with public email/password sign-up enabled) and uses the `better-auth.session_token` cookie.',
        '- **dev**: interim credential endpoints at `/api/auth/dev-login`, `/api/auth/dev-session`, `/api/auth/dev-logout` using an HMAC-signed cookie.',
        '- **SQLite fallback (`ALLOW_NO_AUTH=true`)**: no auth guard is mounted (local dev / tests only).',
      ].join('\n'),
    )
    .addServer('/', 'Direct backend (local dev / Render)')
    .addServer('/api', 'Astro frontend proxy (same-origin)')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Neon Auth JWT (used when AUTH_MODE=neon)',
      },
      'bearer',
    )
    .addCookieAuth(
      'better-auth.session_token',
      {
        type: 'apiKey',
        in: 'cookie',
        description: 'Session cookie (used when AUTH_MODE=better or dev)',
      },
      'session-cookie',
    )
    .addTag('Health', 'Service and database health checks')
    .addTag('Auth', 'Session mode inspection, active session, and dev login')
    .addTag('Books', 'Multi-user PDF library, extraction, and per-user reading state')
    .build();
}

export function createSwaggerDocument(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(app, buildSwaggerConfig());
}

export function setupSwagger(
  app: INestApplication,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isSwaggerEnabled(env)) {
    return false;
  }

  const document = createSwaggerDocument(app);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
    yamlDocumentUrl: 'docs-yaml',
    customSiteTitle: 'Ignit API — Swagger UI',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });
  return true;
}
