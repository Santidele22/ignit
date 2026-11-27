import { Body, Controller, Get, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RouteSessionUser } from '../auth/guards/session-reader.js';
import { ApiSessionAuth } from '../common/swagger/api-decorators.js';
import { LicensesService } from './licenses.service.js';

@ApiTags('licenses')
@ApiSessionAuth()
@Controller('licenses')
export class LicensesController {
  constructor(private readonly licensesService: LicensesService) {}

  @Post('acquire')
  @ApiOperation({ summary: 'Acquire a device-bound wrapped CEK license for an editorial book' })
  acquire(
    @Body() body: { bookId: number; deviceId: string },
    @Req() req: { user?: RouteSessionUser },
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    return this.licensesService.acquire(userId, Number(body.bookId), String(body.deviceId));
  }

  @Get('my')
  @ApiOperation({ summary: 'List active and historical licenses for the current user' })
  listMine(@Req() req: { user?: RouteSessionUser }) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    return this.licensesService.listForUser(userId);
  }
}
