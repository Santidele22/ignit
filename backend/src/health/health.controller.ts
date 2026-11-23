import { Controller, Get, Header } from '@nestjs/common';
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

const RETRY_DELAY_MS = 500;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Keep-alive health endpoint with a real database round-trip, at
 * `/health-db` (public and side-effect free). Retries once after a brief
 * pause so a stale pooled socket right after Neon suspend/wake does not fail
 * the probe needlessly, while still failing (500) if the database stays down.
 */
@ApiTags('Health')
@Controller()
export class HealthDbController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get('health-db')
  @AllowAnonymous()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Database liveness check',
    description: 'Executes `SELECT 1` with one 500 ms retry on transient connection failure.',
  })
  @ApiOkResponse({
    description: 'Database responded',
    schema: { type: 'object', properties: { ok: { type: 'boolean', example: true } } },
  })
  @ApiInternalServerErrorResponse({ description: 'Database query failed after retry' })
  async check(): Promise<{ ok: boolean }> {
    return this.checkWithRetry();
  }

  async checkWithRetry(
    sleepImpl: (ms: number) => Promise<void> = defaultSleep,
  ): Promise<{ ok: boolean }> {
    try {
      await this.dataSource.query('SELECT 1');
      return { ok: true };
    } catch {
      await sleepImpl(RETRY_DELAY_MS);
      await this.dataSource.query('SELECT 1');
      return { ok: true };
    }
  }
}
