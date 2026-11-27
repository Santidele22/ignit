import { Body, Controller, HttpCode, HttpStatus, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RouteSessionUser } from '../auth/guards/session-reader.js';
import { ApiSessionAuth } from '../common/swagger/api-decorators.js';
import { SyncService } from './sync.service.js';
import type { SyncPullResponse, SyncPushItem, SyncPushResponse } from './sync.types.js';

@ApiTags('sync')
@ApiSessionAuth()
@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('push')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Push offline outbox deltas (books, reading states, private Tier 2 upload URLs)' })
  push(
    @Body() body: { items?: SyncPushItem[] },
    @Req() req: { user?: RouteSessionUser },
  ): Promise<SyncPushResponse> {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    return this.syncService.push(userId, Array.isArray(body?.items) ? body.items : []);
  }

  @Post('pull')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pull deltas since lastSyncAt (metadata, reading states, presigned .igb URLs)' })
  pull(
    @Body() body: { since?: number },
    @Req() req: { user?: RouteSessionUser },
  ): Promise<SyncPullResponse> {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    const since = typeof body?.since === 'number' && Number.isFinite(body.since) ? body.since : 0;
    return this.syncService.pull(userId, since);
  }
}
