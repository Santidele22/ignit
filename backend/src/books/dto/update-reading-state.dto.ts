import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReadingProgressDto {
  @ApiProperty({ type: Number, minimum: 1, example: 12 })
  @IsInt()
  @Min(1)
  page: number;

  @ApiProperty({ type: Number, minimum: 0, maximum: 100, example: 24.5 })
  @IsNumber()
  @Min(0)
  @Max(100)
  pct: number;

  @ApiPropertyOptional({ type: String, maxLength: 64, example: 'c-12-3' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  chunkId?: string;
}

export class ReadingMarkDto {
  @ApiProperty({ type: String, maxLength: 64, example: 'mark-1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  id: string;

  @ApiProperty({ enum: ['underline', 'note', 'lexicon'], example: 'underline' })
  @IsString()
  @IsIn(['underline', 'note', 'lexicon'])
  kind: 'underline' | 'note' | 'lexicon';

  @ApiPropertyOptional({ enum: ['aka', 'bronce', 'tinta'], example: 'bronce' })
  @IsOptional()
  @IsString()
  @IsIn(['aka', 'bronce', 'tinta'])
  ink?: 'aka' | 'bronce' | 'tinta';

  @ApiProperty({ type: String, maxLength: 128, example: 'c-12-3:10-42' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  anchor: string;

  @ApiPropertyOptional({ type: String, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string;

  @ApiPropertyOptional({ type: String, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ReadingWordDto {
  @ApiProperty({ type: String, maxLength: 120, example: 'ephemeral' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  term: string;

  @ApiPropertyOptional({ type: String, maxLength: 240, example: 'efímero' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  trans?: string;

  @ApiPropertyOptional({ type: String, maxLength: 128, example: 'c-12-3' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  anchor?: string;
}

export class UpdateReadingStateDto {
  @ApiPropertyOptional({ type: () => ReadingProgressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReadingProgressDto)
  progress?: ReadingProgressDto;

  @ApiPropertyOptional({ type: () => [ReadingMarkDto], maxItems: 500 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ReadingMarkDto)
  marks?: ReadingMarkDto[];

  @ApiPropertyOptional({ type: () => [ReadingWordDto], maxItems: 500 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ReadingWordDto)
  words?: ReadingWordDto[];
}
