import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Request, Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ensureUserExists } from '../../users/ensure-user-exists.js';
import { User } from '../../users/entities/user.entity.js';
import { DevAuthService } from './dev-auth.service.js';
import type { DevUser } from './dev-auth.service.js';
import { DevLoginDto } from './dto/dev-login.dto.js';

@ApiTags('Auth')
@Controller('api/auth')
export class DevAuthController {
  constructor(
    private readonly devAuth: DevAuthService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  @Post('dev-login')
  @AllowAnonymous()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Interim dev login (AUTH_MODE=dev only)',
    description: 'Verifies `.env` credentials, sets the signed HMAC session cookie, and enforces a per-IP rate limit.',
  })
  @ApiOkResponse({ description: 'Authenticated dev user and Set-Cookie header' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  @ApiTooManyRequestsResponse({ description: 'Too many failed login attempts (includes Retry-After header)' })
  async login(
    @Body() dto: DevLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: DevUser }> {
    const limit = this.devAuth.checkLoginLimit(request.ip);
    if (!limit.allowed) {
      response.setHeader('Retry-After', String(limit.retryAfterSeconds));
      throw new HttpException(
        'Has superado los intentos de login permitidos. Reintenta más tarde.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!this.devAuth.verifyCredentials(dto.email, dto.password)) {
      this.devAuth.recordLoginFailure(request.ip);
      throw new UnauthorizedException();
    }
    this.devAuth.clearLoginFailures(request.ip);

    const session = this.devAuth.createSession(response.req.secure);
    await ensureUserExists(this.usersRepository, session.user);

    response.setHeader('Set-Cookie', session.cookie);
    return { user: session.user };
  }

  @Get('dev-session')
  @AllowAnonymous()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Inspect interim dev session (AUTH_MODE=dev only)',
    description: 'Validates the HMAC session cookie and returns `{ user }`, or 401 when missing/invalid.',
  })
  @ApiOkResponse({ description: 'Active dev user' })
  @ApiUnauthorizedResponse({ description: 'Missing, expired, or forged session cookie' })
  session(@Req() request: Request): { user: DevUser } {
    const user = this.devAuth.readSession(request.headers.cookie);

    if (!user) {
      throw new UnauthorizedException();
    }

    return { user };
  }

  @Post('dev-logout')
  @AllowAnonymous()
  @HttpCode(200)
  @ApiOperation({ summary: 'Clear interim dev session cookie (AUTH_MODE=dev only)' })
  @ApiOkResponse({
    description: 'Session cookie cleared',
    schema: { type: 'object', properties: { success: { type: 'boolean', example: true } } },
  })
  logout(@Res({ passthrough: true }) response: Response): { success: true } {
    response.setHeader('Set-Cookie', this.devAuth.clearSessionCookie(response.req.secure));
    return { success: true };
  }
}
