import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RouteSessionUser } from '../auth/guards/session-reader.js';
import { ApiSessionAuth } from '../common/swagger/api-decorators.js';
import { DevicesService, type RegisterDeviceInput } from './devices.service.js';

@ApiTags('devices')
@ApiSessionAuth()
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a reading device with its hardware-backed public key' })
  register(@Body() body: RegisterDeviceInput, @Req() req: { user?: RouteSessionUser }) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    return this.devicesService.register(userId, body);
  }

  @Get()
  @ApiOperation({ summary: 'List registered devices for the current user' })
  list(@Req() req: { user?: RouteSessionUser }) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    return this.devicesService.listForUser(userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke a device and invalidate its offline reading licenses' })
  revoke(@Param('id') id: string, @Req() req: { user?: RouteSessionUser }) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    return this.devicesService.revoke(userId, id);
  }
}
