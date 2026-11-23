import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { authMode, authStackMounted } from './auth-mode.js';
import type { AuthMode } from './auth-mode.js';

/**
 * Public auth source the frontend reads to pick its client. It is mounted in
 * every mode (Better Auth, interim dev auth, and neither) at `/session-mode`,
 * which the browser reaches as `/api/session-mode` through the dev proxy: the
 * `/api/auth/*` namespace belongs to the mounted auth stack, so the mode
 * endpoint lives outside it and stays reachable in both modes.
 *
 * `mode` is the configured stack; `guarded` reports whether the guard pair is
 * actually mounted. They can diverge: `AUTH_MODE=better` without
 * `DATABASE_URL` configures Better Auth but mounts no stack (and refuses to
 * boot unless `ALLOW_NO_AUTH=true`), so the frontend can tell "no session
 * reader will ever answer" apart from "Better Auth is up".
 */
@ApiTags('Auth')
@Controller()
export class SessionModeController {
  @Get('session-mode')
  @AllowAnonymous()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Active authentication mode',
    description:
      'Reports the configured auth stack (`better`, `dev`, or `neon`) and whether route guards are active (`guarded`). Also used as the Render healthCheckPath.',
  })
  @ApiOkResponse({
    description: 'Current auth mode and guard status',
    schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['better', 'dev', 'neon'], example: 'neon' },
        guarded: { type: 'boolean', example: true },
      },
    },
  })
  sessionMode(): { mode: AuthMode; guarded: boolean } {
    return { mode: authMode, guarded: authStackMounted };
  }
}
