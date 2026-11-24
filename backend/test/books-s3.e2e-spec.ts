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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevAuthService } from '../src/auth/dev/dev-auth.service.js';
import { DEV_SESSION_COOKIE, readCookie } from '../src/auth/dev/dev-session.js';
import {
  SESSION_READER,
  type RouteSession,
  type SessionReader,
} from '../src/auth/guards/session-reader.js';
import { MINIMAL_PDF_BUFFER } from './helpers/pdf-fixture.js';

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'dev-password-1234';
const DEV_SESSION_SECRET = 'dev-session-secret-for-tests';
const SIGNED_URL = 'https://signed.example/books/redirect';
const UPLOAD_DIR = 'uploads/books-s3-e2e';

const aws = vi.hoisted(() => ({
  send: vi.fn(),
  getSignedUrl: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    send(command: unknown): Promise<unknown> {
      return aws.send(command);
    }
  }
  class PutObjectCommand {
    constructor(public readonly input: unknown) {}
  }
  class GetObjectCommand {
    constructor(public readonly input: unknown) {}
  }
  class DeleteObjectCommand {
    constructor(public readonly input: unknown) {}
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: aws.getSignedUrl,
}));

delete process.env.DATABASE_URL;
process.env.AUTH_MODE = 'dev';
process.env.ADMIN_EMAIL = ADMIN_EMAIL;
process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
process.env.DEV_SESSION_SECRET = DEV_SESSION_SECRET;
process.env.BOOKS_STORAGE = 's3';
process.env.AWS_ACCESS_KEY_ID = 'e2e-access-key';
process.env.AWS_SECRET_ACCESS_KEY = 'e2e-secret-key';
process.env.AWS_ENDPOINT_URL_S3 = 'https://s3.e2e.test';
process.env.AWS_REGION = 'us-east-2';
delete process.env.ADMIN_NAME;
process.env.BOOKS_UPLOAD_DIR = UPLOAD_DIR;

const { AppModule } = await import('../src/app.module.js');

const NON_ADMIN_TOKEN = 'non-admin-session';
const NON_ADMIN_USER = {
  id: 'user-b',
  email: 'member@example.com',
  name: 'Member',
  role: 'user',
};

class DevSessionReaderWithMember implements SessionReader {
  private readonly devAuth = new DevAuthService();

  async read(headers: IncomingHttpHeaders): Promise<RouteSession | null> {
    if (readCookie(headers.cookie, DEV_SESSION_COOKIE) === NON_ADMIN_TOKEN) {
      return { user: NON_ADMIN_USER };
    }

    const user = this.devAuth.readSession(headers.cookie);
    return user ? { user } : null;
  }
}

describe('Books with BOOKS_STORAGE=s3 (e2e, mocked S3)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    aws.send.mockReset();
    aws.getSignedUrl.mockReset();
    aws.getSignedUrl.mockResolvedValue(SIGNED_URL);
    aws.send.mockResolvedValue({});

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SESSION_READER)
      .useValue(new DevSessionReaderWithMember())
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

  async function signIn() {
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
  const pdfBuffer = MINIMAL_PDF_BUFFER;

  it('uploads the PDF to the bucket, stores the object key and cleans the temp file', async () => {
    const browser = await signIn();
    const created = await browser.post('/books').send(cleanCode).expect(201);
    const id = created.body.id;

    const uploaded = await browser
      .post(`/books/${id}/file`)
      .attach('file', pdfBuffer, { filename: 'clean-code.pdf', contentType: 'application/pdf' })
      .expect(201);

    expect(uploaded.body.filePath).toMatch(/^\d+-[0-9a-f]{12}\.pdf$/);
    expect(uploaded.body.filePath).not.toContain('/');
    expect(uploaded.body.originalName).toBe('clean-code.pdf');

    const put = aws.send.mock.calls.find(([command]) =>
      (command as { input: { Body?: Buffer } }).input?.Body,
    ) as [{ input: Record<string, unknown> }] | undefined;
    expect(put).toBeDefined();
    expect(put![0].input.Bucket).toBe('books');
    expect(put![0].input.Key).toBe(uploaded.body.filePath);
    expect(put![0].input.Body).toEqual(pdfBuffer);

    const leftovers = await readdir(UPLOAD_DIR).catch(() => [] as string[]);
    expect(leftovers.filter((name) => name.endsWith('.pdf'))).toEqual([]);
  });

  it('redirects downloads of published books to the short-lived presigned URL', async () => {
    const browser = await signIn();
    const created = await browser.post('/books').send(cleanCode).expect(201);
    const id = created.body.id;
    await browser
      .post(`/books/${id}/file`)
      .attach('file', pdfBuffer, { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(201);
    await browser.patch(`/books/${id}`).send({ published: true }).expect(200);

    const res = await request(server())
      .get(`/books/${id}/download`)
      .redirects(0)
      .expect(302);
    expect(res.headers.location).toBe(SIGNED_URL);

    const sentCommands = aws.send.mock.calls.map(
      ([command]) => (command as { constructor: { name: string } }).constructor?.name,
    );
    expect(sentCommands).not.toContain('GetObjectCommand');
    expect(aws.getSignedUrl).toHaveBeenCalledTimes(1);
    expect((aws.getSignedUrl.mock.calls[0]![1] as { input: { Key: string } }).input.Key).toBeTruthy();

    await request(server()).get('/books').expect(200);
  });

  it('keeps the row untouched and answers 502 when the storage upload fails', async () => {
    aws.send.mockRejectedValue(new Error('S3 unavailable'));
    const browser = await signIn();
    const created = await browser.post('/books').send({ ...cleanCode, published: true }).expect(201);
    const id = created.body.id;

    await browser
      .post(`/books/${id}/file`)
      .attach('file', pdfBuffer, { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(502);

    const read = await request(server()).get(`/books/${id}`).expect(200);
    expect(read.body.filePath).toBeNull();

    aws.send.mockResolvedValue({});
    await browser
      .post(`/books/${id}/file`)
      .attach('file', pdfBuffer, { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(201);
  });

  it('deletes the stored object when the book is removed', async () => {
    const browser = await signIn();
    const created = await browser.post('/books').send(cleanCode).expect(201);
    const id = created.body.id;
    const uploaded = await browser
      .post(`/books/${id}/file`)
      .attach('file', pdfBuffer, { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(201);

    await browser.delete(`/books/${id}`).expect(200);

    const deleteCall = aws.send.mock.calls.find(([command]) =>
      (command as { constructor: { name: string } }).constructor?.name === 'DeleteObjectCommand',
    ) as [{ input: Record<string, unknown> }] | undefined;
    expect(deleteCall).toBeDefined();
    expect(deleteCall![0].input).toEqual({ Bucket: 'books', Key: uploaded.body.filePath });
  });
});
