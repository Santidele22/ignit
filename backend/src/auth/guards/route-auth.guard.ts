import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SESSION_READER } from './session-reader.js';
import type {
  RouteSession,
  RouteSessionUser,
  SessionReader,
} from './session-reader.js';

/**
 * Metadata key written by `@AllowAnonymous()` (and `@Public()`) in
 * `@thallesp/nestjs-better-auth`. Both stack guards already read it, so the
 * decorators on the controllers keep meaning the same thing in both modes.
 */
const ALLOW_ANONYMOUS_KEY = 'PUBLIC';

/**
 * Unified global session guard, registered through `APP_GUARD` for the
 * mounted auth stack whatever `AUTH_MODE` says (the stack itself is picked by
 * the injected `SessionReader`).
 *
 * Policy: every route needs a session unless it is marked
 * `@AllowAnonymous()`; an anonymous caller gets `401`. The resolved session is
 * attached to the request as `session` and `user` before the check, so
 * handlers keep what the Better Auth guard gave them and `@Session()` keeps
 * working. Role checks belong to `RouteRolesGuard` (the next `APP_GUARD`).
 *
 * This replaces the previous per-mode guards: the library's `AuthGuard`
 * (disabled with `disableGlobalAuthGuard`) and the interim `DevAuthGuard`,
 * which only guarded mutations and left admin-only GET routes open.
 */
@Injectable()
export class RouteAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SESSION_READER) private readonly sessions: SessionReader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<
      Request & {
        session?: RouteSession | null;
        user?: RouteSessionUser | null;
      }
    >();

    const session = await this.sessions.read(request.headers);
    request.session = session ?? null;
    request.user = session?.user ?? null;

    const isPublic = this.reflector.getAllAndOverride<boolean>(
      ALLOW_ANONYMOUS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic) {
      return true;
    }

    if (!session) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
