import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import type { IncomingHttpHeaders } from 'node:http';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { DevAuthService } from '../src/auth/dev/dev-auth.service.js';
import { DEV_SESSION_COOKIE, readCookie, signDevSession } from '../src/auth/dev/dev-session.js';
import {
  SESSION_READER,
  type RouteSession,
  type SessionReader,
} from '../src/auth/guards/session-reader.js';

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'dev-password-1234';
const DEV_SESSION_SECRET = 'dev-session-secret-for-tests';
const DEV_SESSION_TTL = '600';

delete process.env.DATABASE_URL;
process.env.AUTH_MODE = 'dev';
process.env.ADMIN_EMAIL = ADMIN_EMAIL;
process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
process.env.DEV_SESSION_SECRET = DEV_SESSION_SECRET;
process.env.DEV_SESSION_TTL = DEV_SESSION_TTL;
delete process.env.ADMIN_NAME;

const { AppModule } = await import('../src/app.module.js');

const NON_ADMIN_TOKEN = 'non-admin-session';
const NON_ADMIN_USER = {
  id: 'user-member',
  email: 'member@example.com',
  name: 'Member',
  role: 'user',
};

class DevSessionReaderWithNonAdmin implements SessionReader {
  private readonly devAuth = new DevAuthService();

  async read(headers: IncomingHttpHeaders): Promise<RouteSession | null> {
    if (readCookie(headers.cookie, DEV_SESSION_COOKIE) === NON_ADMIN_TOKEN) {
      return { user: NON_ADMIN_USER };
    }
    const user = this.devAuth.readSession(headers.cookie);
    return user ? { user } : null;
  }
}

describe('Dev auth (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SESSION_READER)
      .useValue(new DevSessionReaderWithNonAdmin())
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function server() {
    return app.getHttpServer();
  }

  function setCookie(response: request.Response): string {
    const header = response.headers['set-cookie'] as unknown as string[] | undefined;
    return header?.[0] ?? '';
  }

  function signIn() {
    return request(server())
      .post('/api/auth/dev-login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
  }

  const bookInput = {
    title: 'Dune',
    author: 'Frank Herbert',
    description: 'Novela de Arrakis.',
    status: 'queued',
  };

  it('reports dev mode and guarded=true on /session-mode', async () => {
    const response = await request(server()).get('/session-mode').expect(200);
    expect(response.body).toEqual({ mode: 'dev', guarded: true });
  });

  it('signs in, sets HttpOnly cookie, and creates books owned by dev-admin', async () => {
    const response = await signIn();
    expect(response.body).toEqual({
      user: { email: ADMIN_EMAIL, name: 'Admin', role: 'admin', id: 'dev-admin' },
    });

    const cookie = setCookie(response);
    expect(cookie).toContain(`${DEV_SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');

    const browser = request.agent(server());
    await browser
      .post('/api/auth/dev-login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);

    const created = await browser.post('/books').send(bookInput).expect(201);
    expect(created.body.ownerId).toBe('dev-admin');
  });

  it('rejects wrong credentials with 401 and forged/expired cookies', async () => {
    await request(server())
      .post('/api/auth/dev-login')
      .send({ email: ADMIN_EMAIL, password: 'wrong' })
      .expect(401);

    const now = Math.floor(Date.now() / 1000);
    const forged = signDevSession(
      { email: ADMIN_EMAIL, name: 'Admin', role: 'admin', exp: now + 600 },
      'another-secret',
    );
    const expired = signDevSession(
      { email: ADMIN_EMAIL, name: 'Admin', role: 'admin', exp: now - 10 },
      DEV_SESSION_SECRET,
    );

    for (const token of [forged, expired]) {
      await request(server())
        .get('/api/auth/dev-session')
        .set('Cookie', `${DEV_SESSION_COOKIE}=${token}`)
        .expect(401);
      await request(server())
        .post('/books')
        .set('Cookie', `${DEV_SESSION_COOKIE}=${token}`)
        .send(bookInput)
        .expect(401);
    }
  });

  it('clears cookie on logout and enforces throttling on failed logins', async () => {
    const browser = request.agent(server());
    await browser
      .post('/api/auth/dev-login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);

    const logout = await browser.post('/api/auth/dev-logout').expect(200);
    expect(logout.body).toEqual({ success: true });
    expect(setCookie(logout)).toContain('Max-Age=0');

    await browser.get('/api/auth/dev-session').expect(401);
    await browser.post('/books').send(bookInput).expect(401);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(server())
        .post('/api/auth/dev-login')
        .send({ email: ADMIN_EMAIL, password: 'wrong-password' })
        .expect(401);
    }

    const blocked = await request(server())
      .post('/api/auth/dev-login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });
});
