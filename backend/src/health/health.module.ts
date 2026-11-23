import { Module } from '@nestjs/common';
import { HealthDbController } from './health.controller.js';

@Module({
  controllers: [HealthDbController],
})
export class HealthModule {}
