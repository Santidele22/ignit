import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReadingStatus } from '../../common/enums/reading-status.enum.js';
import { BookKind } from '../../common/enums/book-kind.enum.js';

/**
 * Body of `POST /books`. `ownerId` is intentionally omitted: the API always
 * derives book ownership from the authenticated session user.
 */
export class CreateBookDto {
  @ApiProperty({ type: String, example: 'Designing Data-Intensive Applications' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ type: String, example: 'Martin Kleppmann' })
  @IsString()
  @IsNotEmpty()
  author: string;

  @ApiProperty({ type: String, example: 'The big ideas behind reliable, scalable, and maintainable systems.' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ enum: ReadingStatus, enumName: 'ReadingStatus', example: ReadingStatus.READING })
  @IsEnum(ReadingStatus)
  status: ReadingStatus;

  @ApiPropertyOptional({ enum: BookKind, enumName: 'BookKind', default: BookKind.NO_TECNICO })
  @IsOptional()
  @IsEnum(BookKind)
  kind?: BookKind;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  review?: string;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  coverUrl?: string | null;
}
