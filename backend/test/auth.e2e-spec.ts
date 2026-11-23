import { randomUUID } from 'node:crypto';
import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const LOCAL_DATABASE_URL = 'postgres://app:app@localhost:5432/ignit';
const databaseUrl = process.env.DATABASE_URL ?? LOCAL_DATABASE_URL;

async function isReachable(url: string): Promise<boolean> {
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 1000,
  });
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

const postgresAvailable = await isReachable(databaseUrl);

describe.skipIf(!postgresAvailable)('Auth (e2e)', () => {
  const createdEmails: string[] = [];
  const password = 'smoke-password-1234';
  let app: INestApplication<App>;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
    process.env.BETTER_AUTH_SECRET ??= 'integration-test-secret-32-characters';
    process.env.BETTER_AUTH_RATE_LIMIT = 'false';

    const { AppModule } = await import('../src/app.module.js');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(new ExpressAdapter(), {
      bodyParser: false,
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (createdEmails.length === 0) return;
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query('delete from "user" where email = any($1)', [createdEmails]);
    } finally {
      await pool.end();
    }
  });

  function newEmail(): string {
    const email = `auth-smoke-${randomUUID()}@example.com`;
    createdEmails.push(email);
    return email;
  }

  it('allows public email/password sign-up, reads session, and guards private endpoints', async () => {
    const email = newEmail();
    const browser = request.agent(app.getHttpServer());

    const signUp = await browser
      .post('/api/auth/sign-up/email')
      .send({ email, password, name: 'Ignit Reader' })
      .expect(200);
    expect(signUp.body.user.email).toBe(email);

    const me = await browser.get('/auth/me').expect(200);
    expect(me.body.user.email).toBe(email);
    expect(me.body.user.name).toBe('Ignit Reader');

    await request(app.getHttpServer()).get('/books?mine=true').expect(401);
    await browser.get('/books?mine=true').expect(200);
    await request(app.getHttpServer()).get('/books').expect(200);
  });
});
