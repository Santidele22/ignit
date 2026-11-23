import { Injectable } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import { DevAuthService } from '../dev/dev-auth.service.js';
import type { RouteSession, SessionReader } from './session-reader.js';

/**
 * Dev-mode reader (`AUTH_MODE=dev`): resolves the signed session cookie with
 * `DevAuthService`. A valid cookie means the hardcoded administrator.
 */
@Injectable()
export class DevSessionReader implements SessionReader {
  constructor(private readonly devAuth: DevAuthService) {}

  async read(headers: IncomingHttpHeaders): Promise<RouteSession | null> {
    const user = this.devAuth.readSession(headers.cookie);

    return user ? { user } : null;
  }
}
