import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { ApiSessionAuth } from '../common/swagger/api-decorators.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  /**
   * Current Better Auth session. The global `AuthGuard` registered by
   * `AuthModule` rejects anonymous callers, so a response here always carries
   * the session and its user.
   */
  @Get('me')
  @ApiSessionAuth()
  @ApiOperation({
    summary: 'Current authenticated session',
    description: 'Returns the session and user resolved by the active session reader.',
  })
  @ApiOkResponse({ description: 'Active user session object' })
  me(@Session() session: UserSession): UserSession {
    return session;
  }
}
