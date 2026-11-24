import 'reflect-metadata';
import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { IncomingHttpHeaders } from 'node:http';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SESSION_READER,
  type RouteSession,
  type SessionReader,
} from '../../auth/guards/session-reader.js';
import { RouteAuthGuard } from '../../auth/guards/route-auth.guard.js';
import { RouteRolesGuard } from '../../auth/guards/route-roles.guard.js';
import { EDITORIAL_STYLE_REFERENCE } from '../ai/editorial-reference.js';
import { AiStyleReferenceController } from './ai-style-reference.controller.js';

class HeaderSessionReader implements SessionReader {
  async read(headers: IncomingHttpHeaders): Promise<RouteSession | null> {
    const role = headers['x-test-role'];
    if (typeof role !== 'string' || role.length === 0) return null;
    return {
      user: { id: 'admin-1', email: 'admin@ignit.app', name: 'Admin', role },
    };
  }
}

describe('AiStyleReferenceController', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AiStyleReferenceController],
      providers: [
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

  it('answers the exact editorial reference for an admin session', async () => {
    const response = await request(server())
      .get('/admin/ai/style-reference')
      .set('x-test-role', 'admin')
      .expect(200);

    expect(response.body).toEqual(EDITORIAL_STYLE_REFERENCE);
  });

  it('rejects a non-admin session with 403', async () => {
    await request(server())
      .get('/admin/ai/style-reference')
      .set('x-test-role', 'user')
      .expect(403);
  });

  it('rejects an anonymous caller with 401', async () => {
    await request(server()).get('/admin/ai/style-reference').expect(401);
  });
});
