import 'reflect-metadata';
import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { IncomingHttpHeaders } from 'node:http';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_READER,
  type RouteSession,
  type SessionReader,
} from '../../auth/guards/session-reader.js';
import { RouteAuthGuard } from '../../auth/guards/route-auth.guard.js';
import { RouteRolesGuard } from '../../auth/guards/route-roles.guard.js';
import { BooksAdminController } from './books-admin.controller.js';
import { BooksAdminService } from './books-admin.service.js';

/**
 * Header-driven session reader: the isolated app mounts the same global guard
 * pair the `AuthModule` registers, so the admin routes are exercised with the
 * production role pipeline (401 without a session, 403 without `admin`).
 */
class HeaderSessionReader implements SessionReader {
  async read(headers: IncomingHttpHeaders): Promise<RouteSession | null> {
    const role = headers['x-test-role'];
    if (typeof role !== 'string' || role.length === 0) return null;
    return {
      user: { id: 'admin-1', email: 'admin@ignit.app', name: 'Admin', role },
    };
  }
}

describe('BooksAdminController', () => {
  let app: INestApplication<App>;
  let list: ReturnType<typeof vi.fn>;
  let review: ReturnType<typeof vi.fn>;
  let unpublish: ReturnType<typeof vi.fn>;
  let firewall: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    list = vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 20 }));
    review = vi.fn(async () => ({ id: 7, reviewStatus: 'approved' }));
    unpublish = vi.fn(async () => ({ id: 7, published: false }));
    firewall = vi.fn(async (id: number) => {
      if (id !== 7) {
        throw new NotFoundException('Este libro no tiene reporte de firewall');
      }
      return { schemaVersion: 1, safe: true, pageCount: 4, violations: [], tiers: [] };
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [BooksAdminController],
      providers: [
        { provide: BooksAdminService, useValue: { list, review, unpublish, firewall } },
        { provide: SESSION_READER, useValue: new HeaderSessionReader() },
        { provide: APP_GUARD, useClass: RouteAuthGuard },
        { provide: APP_GUARD, useClass: RouteRolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('rejects a non-admin session with 403 on both admin routes', async () => {
    await request(server()).get('/admin/books').set('x-test-role', 'user').expect(403);
    await request(server())
      .post('/admin/books/7/review')
      .set('x-test-role', 'user')
      .send({ decision: 'approved' })
      .expect(403);
    expect(list).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });

  it('rejects an anonymous caller with 401 before the role check', async () => {
    await request(server()).get('/admin/books').expect(401);
    expect(list).not.toHaveBeenCalled();
  });

  it('guards the firewall route and answers 404 without a report', async () => {
    await request(server()).get('/admin/books/7/firewall').expect(401);
    await request(server()).get('/admin/books/7/firewall').set('x-test-role', 'user').expect(403);
    expect(firewall).not.toHaveBeenCalled();

    const ok = await request(server())
      .get('/admin/books/7/firewall')
      .set('x-test-role', 'admin')
      .expect(200);
    expect(ok.body).toEqual({
      schemaVersion: 1,
      safe: true,
      pageCount: 4,
      violations: [],
      tiers: [],
    });

    const missing = await request(server())
      .get('/admin/books/9/firewall')
      .set('x-test-role', 'admin')
      .expect(404);
    expect(missing.body.message).toBe('Este libro no tiene reporte de firewall');
  });

  it('lists the requested review page for an admin session', async () => {
    list.mockResolvedValue({
      items: [{ id: 7, reviewStatus: 'pending' }],
      total: 1,
      offset: 5,
      limit: 5,
    });

    const response = await request(server())
      .get('/admin/books?review=pending&page=2&pageSize=5')
      .set('x-test-role', 'admin')
      .expect(200);

    expect(response.body).toEqual({
      items: [{ id: 7, reviewStatus: 'pending' }],
      total: 1,
      offset: 5,
      limit: 5,
    });
    const query = list.mock.calls[0]?.[0] as {
      review?: string;
      offsetValue(): number;
      limitValue(): number;
    };
    expect(query.review).toBe('pending');
    expect(query.offsetValue()).toBe(5);
    expect(query.limitValue()).toBe(5);
  });

  it('answers 400 for an unknown review filter', async () => {
    await request(server())
      .get('/admin/books?review=bogus')
      .set('x-test-role', 'admin')
      .expect(400);
    expect(list).not.toHaveBeenCalled();
  });

  it('accepts published=true|false filter and rejects invalid published values with 400', async () => {
    await request(server())
      .get('/admin/books?published=true')
      .set('x-test-role', 'admin')
      .expect(200);
    const query = list.mock.calls[0]?.[0] as { published?: boolean };
    expect(query.published).toBe(true);

    list.mockClear();
    await request(server())
      .get('/admin/books?published=bogus')
      .set('x-test-role', 'admin')
      .expect(400);
    expect(list).not.toHaveBeenCalled();
  });

  it('reviews as the session user', async () => {
    await request(server())
      .post('/admin/books/7/review')
      .set('x-test-role', 'admin')
      .send({ decision: 'approved', publish: true })
      .expect(201);

    expect(review).toHaveBeenCalledWith(7, { decision: 'approved', publish: true }, 'admin-1');
  });

  it('answers 400 for an invalid decision and never reaches the service', async () => {
    await request(server())
      .post('/admin/books/7/review')
      .set('x-test-role', 'admin')
      .send({ decision: 'maybe' })
      .expect(400);
    expect(review).not.toHaveBeenCalled();
  });

  it('guards unpublish and immediately unpublishes for admins', async () => {
    await request(server()).post('/admin/books/7/unpublish').expect(401);
    await request(server())
      .post('/admin/books/7/unpublish')
      .set('x-test-role', 'user')
      .expect(403);
    expect(unpublish).not.toHaveBeenCalled();

    const ok = await request(server())
      .post('/admin/books/7/unpublish')
      .set('x-test-role', 'admin')
      .send({ note: 'Retiro editorial' })
      .expect(201);
    expect(ok.body).toEqual({ id: 7, published: false });
    expect(unpublish).toHaveBeenCalledWith(7, { note: 'Retiro editorial' }, 'admin-1');
  });
});
