import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

/** Marks an endpoint as requiring an authenticated session with the `admin` role. */
export function ApiAdminAuth() {
  return applyDecorators(
    ApiBearerAuth('bearer'),
    ApiCookieAuth('session-cookie'),
    ApiUnauthorizedResponse({
      description: 'Authentication required (missing or invalid session/JWT)',
    }),
    ApiForbiddenResponse({
      description: 'Admin role required',
    }),
  );
}

/** Marks an endpoint as requiring an authenticated user (owner or admin). */
export function ApiUserAuth() {
  return applyDecorators(
    ApiBearerAuth('bearer'),
    ApiCookieAuth('session-cookie'),
    ApiUnauthorizedResponse({
      description: 'Authentication required (missing or invalid session/JWT)',
    }),
    ApiForbiddenResponse({
      description: 'Insufficient permissions for this resource',
    }),
  );
}

/** Marks an endpoint as requiring any authenticated session. */
export function ApiSessionAuth() {
  return applyDecorators(
    ApiBearerAuth('bearer'),
    ApiCookieAuth('session-cookie'),
    ApiUnauthorizedResponse({
      description: 'Authentication required (missing or invalid session/JWT)',
    }),
  );
}

/** Standard paginated collection envelope `{ items, total, offset, limit }`. */
export class PaginatedResponseDto {
  @ApiProperty({ type: [Object], description: 'Items in the requested page' })
  items: unknown[];

  @ApiProperty({ type: Number, example: 42 })
  total: number;

  @ApiProperty({ type: Number, example: 0 })
  offset: number;

  @ApiProperty({ type: Number, example: 20 })
  limit: number;
}

export class ErrorResponseDto {
  @ApiProperty({ type: Number, example: 400 })
  statusCode: number;

  @ApiProperty({ type: String, example: 'Bad Request' })
  message: string;

  @ApiPropertyOptional({ type: String, example: 'Bad Request' })
  error?: string;
}
