import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UnpublishBookDto {
  @ApiPropertyOptional({
    type: String,
    maxLength: 500,
    description: 'Optional reason for immediate takedown (e.g. publisher request)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
