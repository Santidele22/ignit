import {
  Body,
  ConflictException,
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
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { DevAccountsService } from './dev-accounts.service.js';
import { DevAuthService } from './dev-auth.service.js';
import type { DevUser } from './dev-auth.service.js';
import { DevLoginDto } from './dto/dev-login.dto.js';
import { DevRegisterDto } from './dto/dev-register.dto.js';

@ApiTags('Auth')
@Controller('api/auth')
export class DevAuthController {
  constructor(
    private readonly devAuth: DevAuthService,
    private readonly devAccounts: DevAccountsService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  @Post('dev-register')
  @AllowAnonymous()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Local multi-account registration (AUTH_MODE=dev only)',
    description:
      'Creates a local reader account in SQLite without Better Auth or Neon and sets the signed HMAC session cookie.',
  })
  @ApiCreatedResponse({ description: 'Registered local user and Set-Cookie header' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @ApiConflictResponse({ description: 'Email already registered' })
  async register(
    @Body() dto: DevRegisterDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: DevUser }> {
    if (this.devAuth.isAdminEmail(dto.email)) {
      throw new ConflictException(
        'Ya existe una cuenta registrada con ese correo.',
      );
    }

    const user = await this.devAccounts.register(dto);
    const session = this.devAuth.createSession(response.req.secure, user);

    response.setHeader('Set-Cookie', session.cookie);
    return { user: session.user };
  }

  @Post('dev-login')
  @AllowAnonymous()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Local dev login (AUTH_MODE=dev only)',
    description:
      'Verifies `.env` admin credentials or a locally registered dev account, sets the signed HMAC session cookie, and enforces a per-IP rate limit.',
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

    let session: { cookie: string; user: DevUser };
    if (this.devAuth.verifyCredentials(dto.email, dto.password)) {
      session = this.devAuth.createSession(response.req.secure);
    } else {
      const localUser = await this.devAccounts.verifyCredentials(
        dto.email,
        dto.password,
      );
      if (!localUser) {
        this.devAuth.recordLoginFailure(request.ip);
        throw new UnauthorizedException();
      }
      session = this.devAuth.createSession(response.req.secure, localUser);
    }

    this.devAuth.clearLoginFailures(request.ip);
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
