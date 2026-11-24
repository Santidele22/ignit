import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '@thallesp/nestjs-better-auth';
import type { RouteSessionUser } from '../../auth/guards/session-reader.js';
import { ApiAdminAuth } from '../../common/swagger/api-decorators.js';
import { requireSessionUser } from '../lib/book-access.js';
import { BooksAdminService } from './books-admin.service.js';
import { AdminBooksQueryDto } from './dto/admin-books-query.dto.js';
import { ReviewBookDto } from './dto/review-book.dto.js';

/**
 * Admin-only review surface over uploaded PDFs (S4).
 *
 * The role gate is the class-level `@Roles(['admin'])` read by the global
 * `RouteRolesGuard` (mounted after `RouteAuthGuard`), so an anonymous call is
 * `401` and an authenticated non-admin is `403` before any handler runs; the
 * `isAdminUser` checks elsewhere stay unchanged.
 */
@ApiTags('Admin · Books')
@Controller('admin/books')
@Roles(['admin'])
@ApiAdminAuth()
export class BooksAdminController {
  constructor(private readonly booksAdminService: BooksAdminService) {}

  @Get()
  @ApiOperation({
    summary: 'List the PDF review queue (admin only)',
    description:
      'Paginated envelope `{ items, total, offset, limit }` with the owner email, file size, page count and AI verdict of each upload. `?review=pending|approved|rejected` filters by review state; omit it to list every state. Pagination is `page`/`pageSize` (defaults 1/20).',
  })
  @ApiOkResponse({ description: 'Paginated books with their review and AI columns' })
  @ApiBadRequestResponse({ description: 'Invalid review filter or pagination parameters' })
  list(@Query() query: AdminBooksQueryDto) {
    return this.booksAdminService.list(query);
  }

  @Post(':id/review')
  @ApiOperation({
    summary: 'Accept or reject an uploaded PDF (admin only)',
    description:
      'Records `reviewStatus`, `reviewedBy` (the session user) and `reviewedAt`. A rejection always unpublishes the book; an approval publishes it only when the body also sends `publish: true`.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiCreatedResponse({ description: 'Updated book with its new review state' })
  @ApiBadRequestResponse({ description: 'Invalid decision payload' })
  @ApiNotFoundResponse({ description: 'Book not found' })
  review(
    @Param('id', ParseIntPipe) id: number,
    @Body() reviewBookDto: ReviewBookDto,
    @Req() req: { user?: RouteSessionUser | null },
  ) {
    const user = requireSessionUser(req.user);
    return this.booksAdminService.review(id, reviewBookDto, user.id);
  }

  @Get(':id/firewall')
  @ApiOperation({
    summary: 'Firewall pipeline report of one book (admin only)',
    description:
      'The stored per-tier pipeline report captured when the PDF was attached: tier 0 (header sanity + polyglot), tier 1 (lexical forbidden-name scan) and tier 2 (structural walk), each check marked `passed`, `violation` or `skipped`, with the raw violation codes. Rejected uploads keep their report even though the file was dropped. `404` when no report exists.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'PdfFirewallReport JSON sidecar contents' })
  @ApiNotFoundResponse({ description: 'Book not found or no firewall report for it' })
  firewall(@Param('id', ParseIntPipe) id: number) {
    return this.booksAdminService.firewall(id);
  }
}
