import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
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
import { UnpublishBookDto } from './dto/unpublish-book.dto.js';

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

  @Post(':id/unpublish')
  @ApiOperation({
    summary: 'Immediately unpublish a book from the public catalog (admin only)',
    description:
      'Sets `published = false` immediately so publishers or copyright holders can have titles taken down on demand.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiCreatedResponse({ description: 'Updated book with published=false' })
  @ApiNotFoundResponse({ description: 'Book not found' })
  unpublish(
    @Param('id', ParseIntPipe) id: number,
    @Body() unpublishBookDto: UnpublishBookDto,
    @Req() req: { user?: RouteSessionUser | null },
  ) {
    const user = requireSessionUser(req.user);
    return this.booksAdminService.unpublish(id, unpublishBookDto ?? {}, user.id);
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

  @Post(':id/refine')
  @ApiOperation({
    summary: 'Re-run LLM structural refinement on extracted reading.json (admin only)',
    description:
      'Applies patch-based structural fixes (TOC, heading levels, cross-page merges, header noise drops) on top of the deterministic baseline without rewriting author prose.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiCreatedResponse({ description: 'Summary of applied structural patches' })
  @ApiNotFoundResponse({ description: 'Book not found or no extracted reading.json' })
  refine(@Param('id', ParseIntPipe) id: number) {
    return this.booksAdminService.refineReading(id);
  }

  @Post(':id/refine/revert')
  @ApiOperation({
    summary: 'Revert reading.json to the deterministic baseline (admin only)',
    description: 'Restores `reading.deterministic.json` over `reading.json`.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiCreatedResponse({ description: 'Reverted confirmation' })
  @ApiNotFoundResponse({ description: 'Book not found or no deterministic baseline saved' })
  revertRefinement(@Param('id', ParseIntPipe) id: number) {
    return this.booksAdminService.revertReadingRefinement(id);
  }

  @Get(':id/clutter')
  @ApiOperation({
    summary: 'List AI-detected clutter (dropped and recommended) for a book (admin only)',
    description:
      'Returns the list of artifacts the LLM dropped automatically (e.g. `ePUB v2.1`, page numbers) and items it recommends dropping for human review.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'Clutter list for the book' })
  @ApiNotFoundResponse({ description: 'Book not found or no extracted reading.json' })
  clutter(@Param('id', ParseIntPipe) id: number) {
    return this.booksAdminService.readingClutter(id);
  }

  @Post(':id/clutter/drop')
  @ApiOperation({
    summary: 'Confirm dropping recommended clutter chunks from reading.json (admin only)',
    description: 'Removes the specified chunk IDs from `reading.json` while keeping `reading.deterministic.json` intact.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiCreatedResponse({ description: 'Updated clutter list and dropped count' })
  @ApiNotFoundResponse({ description: 'Book not found or no extracted reading.json' })
  dropClutter(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { chunkIds?: string[] },
  ) {
    return this.booksAdminService.dropReadingClutter(
      id,
      Array.isArray(body?.chunkIds) ? body.chunkIds : [],
    );
  }

  @Post(':id/reextract')
  @ApiOperation({
    summary: 'Re-extract reading.json from the stored PDF and re-run LLM refiner (admin only)',
    description:
      'Downloads the stored PDF, runs the latest deterministic extractor, saves `reading.deterministic.json`, and runs the LLM structural refiner.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiCreatedResponse({ description: 'Re-extraction and refinement summary' })
  @ApiNotFoundResponse({ description: 'Book not found or PDF missing' })
  reextract(@Param('id', ParseIntPipe) id: number) {
    return this.booksAdminService.reextractReading(id);
  }

  @Get(':id/chunks')
  @ApiOperation({
    summary: 'List reading.json chunks for manual structural editing (admin only)',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'Paginated/filtered list of reading chunks' })
  @ApiNotFoundResponse({ description: 'Book not found or no extracted reading.json' })
  chunks(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') page?: string,
    @Query('q') q?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.booksAdminService.getReadingChunks(id, {
      page: page ? Number(page) : undefined,
      q,
      offset: offset ? Number(offset) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Patch(':id/chunks')
  @ApiOperation({
    summary: 'Apply manual structural patches (reclassify, drop, merge) to reading.json (admin only)',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'Summary of manual structural patches applied' })
  @ApiNotFoundResponse({ description: 'Book not found or no extracted reading.json' })
  patchChunks(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { patches?: unknown[] },
  ) {
    return this.booksAdminService.patchReadingChunks(id, body?.patches ?? []);
  }
}
