import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { ROLES_KEY, RouteRolesGuard } from './route-roles.guard.js';

/**
 * Unit tests of the roles guard: the `ROLES` metadata (the key the library's
 * `@Roles()` decorator writes) decides access; a session without the role is
 * rejected with 403. Every dev session is an administrator, so only the
 * Better Auth mode can produce the non-admin case in production.
 */

function contextOf(
  metadata: Record<string, unknown>,
  user: { role?: string | string[] | null } | null | undefined,
): ExecutionContext {
  const request = { user: user ?? undefined };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function reflectorWith(metadata: Record<string, unknown>): Reflector {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) =>
    metadata[key as string],
  );

  return reflector;
}

describe('RouteRolesGuard', () => {
  it('lets routes without role metadata through', () => {
    const guard = new RouteRolesGuard(reflectorWith({}));

    expect(guard.canActivate(contextOf({}, null))).toBe(true);
  });

  it('ignores an empty role list', () => {
    const guard = new RouteRolesGuard(reflectorWith({ [ROLES_KEY]: [] }));

    expect(guard.canActivate(contextOf({}, null))).toBe(true);
  });

  it('rejects a missing session with 403', () => {
    const guard = new RouteRolesGuard(reflectorWith({ [ROLES_KEY]: ['admin'] }));

    expect(() => guard.canActivate(contextOf({}, null))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a session without the required role with 403', () => {
    const guard = new RouteRolesGuard(reflectorWith({ [ROLES_KEY]: ['admin'] }));

    expect(() =>
      guard.canActivate(contextOf({}, { role: 'user' })),
    ).toThrow(ForbiddenException);
  });

  it('accepts the required string role', () => {
    const guard = new RouteRolesGuard(reflectorWith({ [ROLES_KEY]: ['admin'] }));

    expect(guard.canActivate(contextOf({}, { role: 'admin' }))).toBe(true);
  });

  it('matches any of the required roles against an array of user roles', () => {
    const guard = new RouteRolesGuard(
      reflectorWith({ [ROLES_KEY]: ['admin', 'editor'] }),
    );

    expect(guard.canActivate(contextOf({}, { role: ['editor'] }))).toBe(true);
    expect(() =>
      guard.canActivate(contextOf({}, { role: ['viewer', 'user'] })),
    ).toThrow(ForbiddenException);
  });
});
