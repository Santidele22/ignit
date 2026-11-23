import type { IncomingHttpHeaders } from 'node:http';

/**
 * The user shape the route guards and ownership helpers need.
 */
export type RouteSessionUser = {
  id?: string;
  email?: string;
  name?: string;
  role?: string | string[] | null;
  [key: string]: unknown;
};

export type RouteSession = {
  user: RouteSessionUser;
  session?: unknown;
};

export interface SessionReader {
  read(headers: IncomingHttpHeaders): Promise<RouteSession | null>;
}

/** DI token the `AuthModule` providers bind to the mounted stack's reader. */
export const SESSION_READER: symbol = Symbol('SESSION_READER');
