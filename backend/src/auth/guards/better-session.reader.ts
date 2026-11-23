import { Injectable } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import type { RouteSession, SessionReader } from './session-reader.js';

/**
 * Better Auth reader: resolves the session with the auth instance the
 * `@thallesp/nestjs-better-auth` module exposes through its exported
 * `AuthService`, and returns `null` for an anonymous caller. The resolved
 * `RouteSession` keeps `session` on it, exactly like the library's own guard
 * attaches to `request.session`, so `@Session()` keeps working.
 */
@Injectable()
export class BetterSessionReader implements SessionReader {
  constructor(private readonly auth: AuthService) {}

  async read(headers: IncomingHttpHeaders): Promise<RouteSession | null> {
    const session = await this.auth.api.getSession({
      headers: fromNodeHeaders(headers),
    });

    return session ? { user: session.user, session } : null;
  }
}
