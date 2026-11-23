import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IncomingHttpHeaders } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { SESSION_READER } from './session-reader.js';
import { RouteAuthGuard } from './route-auth.guard.js';
import type { SessionReader } from './session-reader.js';

/**
 * Unit tests of the unified session guard: public routes stay open, anything
 * else needs a session (401) and the resolved session is attached to the
 * request so handlers and `@Session()` see it.
 */

type StubRoute = {
  handler: object;
  class: object;
  method: string;
  headers: IncomingHttpHeaders;
};

function contextOf(route: StubRoute): {
  context: ExecutionContext;
  request: {
    headers: IncomingHttpHeaders;
    session?: unknown;
    user?: unknown;
  };
} {
  const request = { headers: route.headers, session: undefined, user: undefined };
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => route.handler,
    getClass: () => route.class,
  } as unknown as ExecutionContext;

  return { context, request };
}

function reflectorWith(metadata: Record<string, unknown>): Reflector {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) =>
    metadata[key as string],
  );

  return reflector;
}

describe('RouteAuthGuard', () => {
  const handler = {};
  const controllerClass = {};
  const route = { handler, class: controllerClass };

  it('resolves the session even on a public route and marks it public', async () => {
    const readSessions = vi.fn(async () => null);
    const reader: SessionReader = { read: readSessions };
    const guard = new RouteAuthGuard(reflectorWith({ PUBLIC: true }), reader);
    const { context, request } = contextOf({
      ...route,
      method: 'GET',
      headers: {},
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    // The session is resolved before the public shortcut, exactly like the
    // library guard does, so `@Session()` keeps working on public routes too.
    expect(readSessions).toHaveBeenCalled();
    expect(request.session).toBe(null);
    expect(request.user).toBe(null);
  });

  it('rejects an anonymous caller with 401', async () => {
    const readSessions = vi.fn(async () => null);
    const reader: SessionReader = { read: readSessions };
    const guard = new RouteAuthGuard(reflectorWith({}), reader);
    const { context } = contextOf({
      ...route,
      method: 'POST',
      headers: { cookie: 'other=value' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('lets a valid session through and attaches it to the request', async () => {
    const session = { user: { email: 'a@b.c', role: 'admin' } };
    const readSessions = vi.fn(async () => session);
    const reader: SessionReader = { read: readSessions };
    const guard = new RouteAuthGuard(reflectorWith({}), reader);
    const { context, request } = contextOf({
      ...route,
      method: 'POST',
      headers: { cookie: 'x=y' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.session).toBe(session);
    expect(request.user).toBe(session.user);
  });

  it('skips non-http contexts', async () => {
    const readSessions = vi.fn(async () => null);
    const reader: SessionReader = { read: readSessions };
    const guard = new RouteAuthGuard(reflectorWith({}), reader);
    const context = {
      getType: () => 'ws',
      switchToHttp: vi.fn(),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(readSessions).not.toHaveBeenCalled();
  });

  it('injects the session reader through the SESSION_READER token', () => {
    expect(SESSION_READER.description).toBe('SESSION_READER');
  });
});
