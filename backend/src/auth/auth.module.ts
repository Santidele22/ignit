import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import { DataSource } from 'typeorm';
import { createAuth } from './auth.js';
import {
  authStackMounted,
  betterAuthMounted,
  devAuthMounted,
  neonAuthConfigError,
  neonAuthMounted,
  noAuthStartupError,
} from './auth-mode.js';
import { AuthController } from './auth.controller.js';
import { DevAuthModule } from './dev/dev-auth.module.js';
import { BetterSessionReader } from './guards/better-session.reader.js';
import { DevSessionReader } from './guards/dev-session.reader.js';
import { NeonSessionReader } from './guards/neon-session.reader.js';
import { RouteAuthGuard } from './guards/route-auth.guard.js';
import { RouteRolesGuard } from './guards/route-roles.guard.js';
import { SESSION_READER } from './guards/session-reader.js';
import { SessionModeController } from './session-mode.controller.js';

// Fail-closed boot: importing this module is the earliest point every entry
// (main.ts, e2e suites) builds the app through, so the startup aborts here —
// before any route exists — when no guard stack would be mounted and the
// owner did not opt out with ALLOW_NO_AUTH=true.
const startupError =
  neonAuthConfigError(process.env) ?? noAuthStartupError(process.env, authStackMounted);
if (startupError) {
  throw new Error(startupError);
}

/**
 * Mounts the configured session reader and the shared route guards. Local
 * Better Auth owns `/api/auth/*`; managed Neon Auth is proxied by the frontend
 * and this API only verifies its bearer JWTs. The default Nest body parser
 * stays enabled unless the local Better Auth module is mounted.
 */
@Module({
  imports: [
    ...(betterAuthMounted
      ? [
          BetterAuthModule.forRoot({
            auth: createAuth(),
            disableGlobalAuthGuard: true,
          }),
        ]
      : []),
    ...(devAuthMounted ? [DevAuthModule.register()] : []),
  ],
  controllers: [
    ...(betterAuthMounted ? [AuthController] : []),
    SessionModeController,
  ],
  providers: [
    ...(betterAuthMounted
      ? [{ provide: SESSION_READER, useClass: BetterSessionReader }]
      : []),
    ...(devAuthMounted ? [{ provide: SESSION_READER, useClass: DevSessionReader }] : []),
    ...(neonAuthMounted
      ? [
          {
            provide: SESSION_READER,
            useFactory: (dataSource: DataSource) =>
              new NeonSessionReader(dataSource, process.env),
            inject: [DataSource],
          },
        ]
      : []),
    ...(authStackMounted
      ? [
          { provide: APP_GUARD, useClass: RouteAuthGuard },
          { provide: APP_GUARD, useClass: RouteRolesGuard },
        ]
      : []),
  ],
})
export class AuthModule {}
