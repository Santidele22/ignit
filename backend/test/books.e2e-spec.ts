import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { readdir } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DevAuthService } from '../src/auth/dev/dev-auth.service.js';
import { DEV_SESSION_COOKIE, readCookie } from '../src/auth/dev/dev-session.js';
import {
  SESSION_READER,
  type RouteSession,
  type SessionReader,
} from '../src/auth/guards/session-reader.js';
import { Book } from '../src/books/entities/book.entity.js';

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'dev-password-1234';
const DEV_SESSION_SECRET = 'dev-session-secret-for-tests';

delete process.env.DATABASE_URL;
process.env.AUTH_MODE = 'dev';
process.env.ADMIN_EMAIL = ADMIN_EMAIL;
process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
process.env.DEV_SESSION_SECRET = DEV_SESSION_SECRET;
delete process.env.ADMIN_NAME;

const { AppModule } = await import('../src/app.module.js');

const USER_A_COOKIE = `${DEV_SESSION_COOKIE}=user-a-session`;
const USER_B_COOKIE = `${DEV_SESSION_COOKIE}=user-b-session`;

const USER_A = { id: 'user-a', email: 'alice@ignit.app', name: 'Alice', role: 'user' };
const USER_B = { id: 'user-b', email: 'bob@ignit.app', name: 'Bob', role: 'user' };

class MultiUserDevSessionReader implements SessionReader {
  private readonly devAuth = new DevAuthService();

  async read(headers: IncomingHttpHeaders): Promise<RouteSession | null> {
    const token = readCookie(headers.cookie, DEV_SESSION_COOKIE);
    if (token === 'user-a-session') return { user: USER_A };
    if (token === 'user-b-session') return { user: USER_B };

    const user = this.devAuth.readSession(headers.cookie);
    return user ? { user } : null;
  }
}

describe('Ignit Books Multi-User (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SESSION_READER)
      .useValue(new MultiUserDevSessionReader())
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

  async function signInAdmin() {
    const browser = request.agent(server());
    await browser
      .post('/api/auth/dev-login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    return browser;
  }

  const cleanCode = {
    title: 'Clean Code',
    author: 'Robert C. Martin',
    description: 'Manual de artesanía sobre buen código.',
    status: 'reading',
  };
  const ddia = {
    title: 'Designing Data-Intensive Applications',
    author: 'Martin Kleppmann',
    description: 'Física de los datos repartidos.',
    status: 'queued',
  };
  const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
  const textPdfBuffer = Buffer.from(
    [
      '%PDF-1.4',
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
      '4 0 obj << /Length 178 >> stream',
      'BT /F1 18 Tf 72 720 Td (Capitulo I: La espera en el invierno) Tj ET',
      'BT /F1 12 Tf 72 680 Td (Drogo contemplaba desde el muro la llanura gris en silencio durante el invierno.) Tj ET',
      'endstream endobj',
      '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
      'xref',
      '0 6',
      '0000000000 65535 f ',
      'trailer << /Root 1 0 R /Size 6 >>',
      '%%EOF',
    ].join('\n'),
  );

  it('allows any authenticated user to create books, derives ownerId from session, and scopes catalog vs ?mine=true', async () => {
    await request(server()).post('/books').send(cleanCode).expect(401);
    await request(server()).get('/books?mine=true').expect(401);

    // User A creates one private and one published book (even spoofing ownerId in body is ignored)
    const privA = await request(server())
      .post('/books')
      .set('Cookie', USER_A_COOKIE)
      .send({ ...cleanCode, published: false, ownerId: 'user-b' })
      .expect(201);
    expect(privA.body.ownerId).toBe('user-a');
    expect(privA.body.isOwner).toBe(true);

    const pubA = await request(server())
      .post('/books')
      .set('Cookie', USER_A_COOKIE)
      .send({ ...ddia, kind: 'tecnico', published: true })
      .expect(201);
    expect(pubA.body.ownerId).toBe('user-a');

    // User B creates one private book
    const privB = await request(server())
      .post('/books')
      .set('Cookie', USER_B_COOKIE)
      .send({ ...cleanCode, title: 'Dune', published: false })
      .expect(201);

    // Public catalog returns ONLY published books without ownerId
    const publicList = await request(server()).get('/books').expect(200);
    expect(publicList.body).toHaveLength(1);
    expect(publicList.body[0].id).toBe(pubA.body.id);
    expect(publicList.body[0]).not.toHaveProperty('ownerId');
    expect(publicList.body[0].isOwner).toBe(false);

    // ?published=false on public route cannot leak private books
    const attemptLeak = await request(server()).get('/books?published=false').expect(200);
    expect(attemptLeak.body).toHaveLength(1);
    expect(attemptLeak.body[0].id).toBe(pubA.body.id);

    // ?mine=true returns only caller's books (private + published)
    const mineA = await request(server()).get('/books?mine=true').set('Cookie', USER_A_COOKIE).expect(200);
    expect(mineA.body.map((b: { id: number }) => b.id)).toEqual([privA.body.id, pubA.body.id]);

    const mineB = await request(server()).get('/books?mine=true').set('Cookie', USER_B_COOKIE).expect(200);
    expect(mineB.body.map((b: { id: number }) => b.id)).toEqual([privB.body.id]);
  });

  it('enforces anti-IDOR isolation on private and published books (including before Multer upload)', async () => {
    const privA = await request(server())
      .post('/books')
      .set('Cookie', USER_A_COOKIE)
      .send({ ...cleanCode, published: false })
      .expect(201);
    const pubA = await request(server())
      .post('/books')
      .set('Cookie', USER_A_COOKIE)
      .send({ ...ddia, published: true })
      .expect(201);

    // Private book returns 404 to anonymous and User B across all routes
    await request(server()).get(`/books/${privA.body.id}`).expect(404);
    await request(server()).get(`/books/${privA.body.id}`).set('Cookie', USER_B_COOKIE).expect(404);
    await request(server()).patch(`/books/${privA.body.id}`).set('Cookie', USER_B_COOKIE).send({ title: 'X' }).expect(404);
    await request(server()).delete(`/books/${privA.body.id}`).set('Cookie', USER_B_COOKIE).expect(404);
    await request(server()).get(`/books/${privA.body.id}/reading`).set('Cookie', USER_B_COOKIE).expect(404);
    await request(server()).get(`/books/${privA.body.id}/download`).set('Cookie', USER_B_COOKIE).expect(404);
    await request(server()).get(`/books/${privA.body.id}/reading-state`).set('Cookie', USER_B_COOKIE).expect(404);

    // Non-owner upload on private book returns 404 and writes no files to disk
    const uploadDir = process.env.BOOKS_UPLOAD_DIR ?? 'uploads/books';
    const beforeFiles = await readdir(uploadDir).catch(() => [] as string[]);
    await request(server())
      .post(`/books/${privA.body.id}/file`)
      .set('Cookie', USER_B_COOKIE)
      .attach('file', pdfBuffer, { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(404);

    // Published book belonging to User A rejects User B mutations with 403
    await request(server()).patch(`/books/${pubA.body.id}`).set('Cookie', USER_B_COOKIE).send({ title: 'X' }).expect(403);
    await request(server()).delete(`/books/${pubA.body.id}`).set('Cookie', USER_B_COOKIE).expect(403);
    await request(server())
      .post(`/books/${pubA.body.id}/file`)
      .set('Cookie', USER_B_COOKIE)
      .attach('file', pdfBuffer, { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(403);
    const afterFiles = await readdir(uploadDir).catch(() => [] as string[]);
    expect(afterFiles).toEqual(beforeFiles);

    // Owner succeeds on their own private book (upload + reading + download)
    await request(server())
      .post(`/books/${privA.body.id}/file`)
      .set('Cookie', USER_A_COOKIE)
      .attach('file', textPdfBuffer, { filename: 'tartaros.pdf', contentType: 'application/pdf' })
      .expect(201);

    const ownerRead = await request(server())
      .get(`/books/${privA.body.id}/reading`)
      .set('Cookie', USER_A_COOKIE)
      .expect(200);
    expect(ownerRead.body.ocrPending).toBe(false);
    expect(ownerRead.body.chunks.length).toBeGreaterThanOrEqual(1);

    const ownerDl = await request(server())
      .get(`/books/${privA.body.id}/download`)
      .set('Cookie', USER_A_COOKIE)
      .expect(200);
    expect(ownerDl.body).toEqual(textPdfBuffer);
  });

  it('serves /reading publicly for published books and isolates reading-state per user', async () => {
    const pubA = await request(server())
      .post('/books')
      .set('Cookie', USER_A_COOKIE)
      .send({ ...ddia, published: true })
      .expect(201);
    const id = pubA.body.id;

    await request(server())
      .post(`/books/${id}/file`)
      .set('Cookie', USER_A_COOKIE)
      .attach('file', textPdfBuffer, { filename: 'ddia.pdf', contentType: 'application/pdf' })
      .expect(201);

    // Anonymous reader can open the Vigilia reading text of a published book
    const anonReading = await request(server()).get(`/books/${id}/reading`).expect(200);
    expect(anonReading.body.bookId).toBe(String(id));

    // Anonymous cannot read/save server reading state
    await request(server()).get(`/books/${id}/reading-state`).expect(401);
    await request(server()).put(`/books/${id}/reading-state`).send({ progress: { page: 2, pct: 10 } }).expect(401);

    // User B finishes User A's published book -> saved for User B only; book.status stays queued
    await request(server())
      .put(`/books/${id}/reading-state`)
      .set('Cookie', USER_B_COOKIE)
      .send({
        progress: { page: 50, pct: 100, chunkId: 'p0050.0001' },
        marks: [{ id: 'm1', kind: 'underline', ink: 'aka', anchor: 'p0001.0001', text: 'Drogo' }],
        words: [{ term: 'vigilia', trans: 'watch' }],
      })
      .expect(200);

    const bookStillQueued = await request(server()).get(`/books/${id}`).expect(200);
    expect(bookStillQueued.body.status).toBe('queued');

    // User A still sees empty state, then advances own progress to reading -> book.status updates
    const stateAInitial = await request(server())
      .get(`/books/${id}/reading-state`)
      .set('Cookie', USER_A_COOKIE)
      .expect(200);
    expect(stateAInitial.body).toEqual({
      bookId: String(id),
      status: 'queued',
      marks: [],
      words: [],
      progress: { page: 1, pct: 0 },
    });

    await request(server())
      .put(`/books/${id}/reading-state`)
      .set('Cookie', USER_A_COOKIE)
      .send({ progress: { page: 3, pct: 15 } })
      .expect(200);

    const bookNowReading = await request(server()).get(`/books/${id}`).expect(200);
    expect(bookNowReading.body.status).toBe('reading');

    // User B's marks and 100% progress remain intact
    const stateB = await request(server())
      .get(`/books/${id}/reading-state`)
      .set('Cookie', USER_B_COOKIE)
      .expect(200);
    expect(stateB.body.progress.pct).toBe(100);
    expect(stateB.body.marks).toHaveLength(1);
    expect(stateB.body.words[0].term).toBe('vigilia');
  });

  it('paginates published books filtered by kind, rate-limits anonymous downloads, and deletes cleanly', async () => {
    const admin = await signInAdmin();
    const tech = await admin
      .post('/books')
      .send({ ...cleanCode, kind: 'tecnico', published: true })
      .expect(201);
    await admin.post('/books').send({ ...ddia, kind: 'no_tecnico', published: true }).expect(201);

    const page = await request(server())
      .get('/books?published=true&kind=tecnico&limit=4&offset=0')
      .expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.items[0].id).toBe(tech.body.id);

    process.env.BOOKS_DAILY_DOWNLOAD_LIMIT = '2';
    await admin
      .post(`/books/${tech.body.id}/file`)
      .attach('file', pdfBuffer, { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(201);
    await request(server()).get(`/books/${tech.body.id}/download`).expect(200);
    await request(server()).get(`/books/${tech.body.id}/download`).expect(200);
    await request(server()).get(`/books/${tech.body.id}/download`).expect(429);
    delete process.env.BOOKS_DAILY_DOWNLOAD_LIMIT;

    await admin.delete(`/books/${tech.body.id}`).expect(200);
    await request(server()).get(`/books/${tech.body.id}`).expect(404);
  });

  it('answers 404 when the stored file is missing on disk', async () => {
    const admin = await signInAdmin();
    const created = await admin.post('/books').send({ ...cleanCode, published: true }).expect(201);
    const books = app.get(DataSource).getRepository(Book);
    await books.save(books.create({ id: created.body.id, filePath: 'uploads/books/missing-000.pdf' }));

    await request(server()).get(`/books/${created.body.id}/download`).expect(404);
  });
});
