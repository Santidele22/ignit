import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const BOOK_METRIC_EVENTS = [
  'read_started',
  'offline_download',
  'cta_click',
] as const;

export type BookMetricEvent = (typeof BOOK_METRIC_EVENTS)[number];

export class RecordBookMetricDto {
  @ApiProperty({
    enum: BOOK_METRIC_EVENTS,
    enumName: 'BookMetricEvent',
    example: 'read_started',
  })
  @IsIn([...BOOK_METRIC_EVENTS])
  event: BookMetricEvent;
}
