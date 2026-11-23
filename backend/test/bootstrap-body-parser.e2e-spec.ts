import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Boot-path regression for the review findings on the body parser: unlike
// `Test.createTestingModule`, building the app through `NestFactory.create`
// applies the factory options `src/main.ts` runs with. This suite boots the
// exact Docker-less fallback (no `DATABASE_URL`, no `AUTH_MODE`), where no
// auth stack is mounted and the parser must stay ON so JSON mutations reach
// their handlers instead of failing validation with an undefined body.
delete process.env.DATABASE_URL;
delete process.env.AUTH_MODE;
const { AppModule } = await import('../src/app.module.js');
const { betterAuthMounted, bodyParserEnabled } = await import(
  '../src/auth/auth-mode.js'
);

describe('Body parser (boot path, e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    // Mirrors src/main.ts through the single shared decision.
    app = await NestFactory.create(AppModule, {
      bodyParser: bodyParserEnabled,
      logger: false,
    });
    // Same call main.ts makes: the boot path must not leak the framework
    // banner either.
    app.disable('x-powered-by');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector)),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('mounts the parser in the fallback boot with no auth stack', () => {
    expect(betterAuthMounted).toBe(false);
    expect(bodyParserEnabled).toBe(true);
    // The parser decision is the only behavior that is statically observable:
    // after the newsletter module left, the fallback ships no public POST, so
    // a bare POST probe can no longer pin the request path end to end.
  });

  it('answers without the X-Powered-By header, like the main.ts boot', async () => {
    const response = await request(app.getHttpServer()).get('/').expect(200);

    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
