import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type {
  RouteSessionUser,
  RouteSession,
} from './session-reader.js';

/**
 * Metadata key written by `@Roles()` in `@thallesp/nestjs-better-auth` (it is
 * a plain `SetMetadata('ROLES', …)`), so the existing decorators keep meaning
 * the same thing in both auth modes.
 */
export const ROLES_KEY = 'ROLES';

/**
 * Unified global roles guard, registered through `APP_GUARD` right after
 * `RouteAuthGuard`: when a route carries `@Roles([...])`, the caller's user
 * needs at least one of those roles or the request gets `403`. Without the
 * metadata the route only needs the session the previous guard checked.
 *
 * The user comes from `request.user`, which `RouteAuthGuard` attached after
 * resolving the session through the mode's `SessionReader`: the dev session is
 * always the hardcoded administrator, and Better Auth exposes the `role` the
 * admin plugin stores.
 */
@Injectable()
export class RouteRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    if (context.getType() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: RouteSessionUser;
      session?: RouteSession | null;
    }>();
    const user = request?.user;
    // No session means no role: the request is rejected the same way it would
    // be with a role that does not match.
    const userRoles =
      user?.role === undefined || user?.role === null
        ? []
        : Array.isArray(user.role)
          ? user.role
          : [user.role];

    if (requiredRoles.some((role) => userRoles.includes(role))) {
      return true;
    }

    throw new ForbiddenException();
  }
}
