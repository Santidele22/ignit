import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto.js';
import { BookKind } from '../../common/enums/book-kind.enum.js';

/**
 * Books collection GET query: offset/limit pagination plus optional
 * `published`, `mine`, and `kind` filters. Public catalog always scopes to
 * `published=true`; `?mine=true` returns the authenticated caller's books.
 */
export class BooksPaginationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    description: 'Filter public catalog (server always enforces published=true unless mine=true)',
  })
  @Transform(({ value }) => value === 'true')
  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'When true (query `?mine=true`), returns only books owned by the authenticated user',
  })
  @Transform(({ value }) => value === 'true')
  @IsOptional()
  @IsBoolean()
  mine?: boolean;

  @ApiPropertyOptional({
    enum: BookKind,
    enumName: 'BookKind',
    description: 'Filter books by shelf kind (`tecnico` or `no_tecnico`)',
  })
  @IsOptional()
  @IsEnum(BookKind)
  kind?: BookKind;
}
