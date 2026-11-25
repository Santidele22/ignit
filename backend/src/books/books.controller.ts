import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiFoundResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { AllowAnonymous, Roles } from '@thallesp/nestjs-better-auth';
import type { FindOptionsWhere } from 'typeorm';
import type { RouteSessionUser } from '../auth/guards/session-reader.js';
import { ApiAdminAuth, ApiSessionAuth, ApiUserAuth } from '../common/swagger/api-decorators.js';
import { BooksService } from './books.service.js';
import { BooksPaginationQueryDto } from './dto/books-pagination.query.dto.js';
import { CreateBookDto } from './dto/create-book.dto.js';
import { RecordBookMetricDto } from './dto/record-book-metric.dto.js';
import { UpdateBookDto } from './dto/update-book.dto.js';
import { UpdateReadingStateDto } from './dto/update-reading-state.dto.js';
import { suggestMetadataFromFilename } from './ai/ai-metadata.service.js';
import { searchGoogleBookCovers } from './ai/cover-search.service.js';
import { respondWithDownload } from './download/download-response.js';
import type { Book } from './entities/book.entity.js';
import { MulterExceptionFilter } from './filters/multer-exception.filter.js';
import { BookOwnerGuard } from './guards/book-owner.guard.js';
import { presentBook } from './http/book-presenter.js';
import { booksPdfInterceptorOptions } from './http/book-upload-config.js';
import { assertStoredPdf, requireUploadedPdf } from './http/uploaded-pdf.js';
import { requireSessionUser } from './lib/book-access.js';
import type { UploadedPdf } from './lib/book-file.js';
import { BOOK_STORAGE } from './storage/book-storage.js';
import type { BookStorage } from './storage/book-storage.js';

@ApiTags('Books')
@Controller('books')
export class BooksController {
  constructor(
    private readonly booksService: BooksService,
    @Inject(BOOK_STORAGE)
    private readonly bookStorage: BookStorage,
  ) {}

  @Post()
  @ApiSessionAuth()
  @ApiOperation({ summary: 'Create a book entry owned by the current user' })
  @ApiCreatedResponse({ description: 'Created book entry' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(
    @Body() createBookDto: CreateBookDto,
    @Req() req: { user?: RouteSessionUser | null },
  ) {
    const user = requireSessionUser(req.user);
    const book = await this.booksService.createForUser(createBookDto, user);
    return presentBook(book, req.user);
  }

  @Get()
  @AllowAnonymous()
  @ApiOperation({
    summary: 'List books',
    description:
      'Public requests always return only `published=true` books. `?mine=true` requires authentication and returns the caller’s library (published and private).',
  })
  @ApiOkResponse({ description: 'Book array or paginated envelope' })
  async findAll(
    @Req() req: { user?: RouteSessionUser | null },
    @Query() query: BooksPaginationQueryDto,
  ) {
    let where: FindOptionsWhere<Book>;
    if (query.mine === true) {
      const user = requireSessionUser(req.user);
      where = {
        ownerId: user.id,
        ...(query.kind ? { kind: query.kind } : {}),
      };
    } else {
      where = {
        published: true,
        ...(query.kind ? { kind: query.kind } : {}),
      };
    }

    if (!query.isPaginated()) {
      const books = await this.booksService.findAll(where);
      return books.map((book) => presentBook(book, req.user));
    }

    const page = await this.booksService.findAllPage(query, where);
    return {
      ...page,
      items: page.items.map((book) => presentBook(book, req.user)),
    };
  }

  @Post('suggest-metadata')
  @ApiSessionAuth()
  @ApiOperation({ summary: 'Fast LLM metadata prefill from a PDF filename' })
  suggestMetadata(@Body() body: { filename?: string }) {
    return suggestMetadataFromFilename(typeof body?.filename === 'string' ? body.filename : '');
  }

  @Get('cover-search')
  @ApiSessionAuth()
  @ApiOperation({
    summary:
      'Search book cover images across Google Books, OpenLibrary, Internet Archive, Project Gutenberg and Wikimedia Commons',
  })
  coverSearch(
    @Query('title') title = '',
    @Query('author') author = '',
    @Query('alt') alt?: string | string[],
  ) {
    const altQueries = (Array.isArray(alt) ? alt : alt ? [alt] : [])
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3);
    return searchGoogleBookCovers(title, author, globalThis.fetch, { altQueries });
  }

  @Get(':id')
  @AllowAnonymous()
  @ApiOperation({
    summary: 'Get book by id',
    description: 'Returns published books to anyone, and private books only to their owner or admin.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'Book entry' })
  @ApiNotFoundResponse({ description: 'Book not found' })
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: RouteSessionUser | null },
  ) {
    const book = await this.booksService.findOneForReader(id, req.user);
    return presentBook(book, req.user);
  }

  @Patch(':id')
  @ApiUserAuth()
  @ApiOperation({ summary: 'Update book metadata (owner or admin only)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'Updated book entry' })
  @ApiNotFoundResponse({ description: 'Book not found' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateBookDto: UpdateBookDto,
    @Req() req: { user?: RouteSessionUser | null },
  ) {
    const book = await this.booksService.updateForUser(id, updateBookDto, req.user);
    return presentBook(book, req.user);
  }

  @Post(':id/file')
  @ApiUserAuth()
  @ApiOperation({
    summary: 'Upload PDF file for a book (owner or admin only)',
    description: 'Accepts multipart `file` (`application/pdf` + `%PDF-` magic bytes, max `BOOKS_MAX_FILE_SIZE` default 50 MiB).',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ description: 'Book updated with stored file metadata' })
  @ApiBadRequestResponse({ description: 'Missing or invalid PDF file' })
  @ApiNotFoundResponse({ description: 'Book not found' })
  @ApiPayloadTooLargeResponse({ description: 'Uploaded PDF exceeds size limit' })
  @ApiBadGatewayResponse({ description: 'Upstream S3 storage upload failed' })
  @UseGuards(BookOwnerGuard)
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', booksPdfInterceptorOptions))
  async uploadFile(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: UploadedPdf | undefined,
    @Req() req: { user?: RouteSessionUser | null },
  ) {
    const uploaded = requireUploadedPdf(file);
    await assertStoredPdf(uploaded);
    const book = await this.booksService.attachFileForUser(id, uploaded, req.user);
    return presentBook(book, req.user);
  }

  @Get(':id/download')
  @Roles(['admin'])
  @ApiAdminAuth()
  @ApiOperation({
    summary: 'Download a book source PDF (admin only)',
    description:
      'Restricted to administrators to prevent direct distribution of the original source PDF. Readers consume the extracted reading document via `GET /books/:id/reading`.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'PDF file stream (local storage)' })
  @ApiFoundResponse({ description: 'Redirect to short-lived S3 presigned URL (S3 storage)' })
  @ApiNotFoundResponse({ description: 'Book not found or missing PDF' })
  async download(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { ip?: string; socket?: { remoteAddress?: string }; user?: RouteSessionUser | null },
    @Res() res: any,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const info = await this.booksService.prepareDownload(id, ip, req.user);
    const delivery = await this.bookStorage.resolveDownload(info.filePath);
    respondWithDownload(res, delivery, info);
  }

  @Post(':id/metrics')
  @AllowAnonymous()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record a basic book metric event',
    description:
      'Atomically increments one per-book counter (`read_started`, `offline_download`, or `cta_click`) for books readable by the caller.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'Metric recorded' })
  @ApiBadRequestResponse({ description: 'Invalid metric event' })
  @ApiNotFoundResponse({ description: 'Book not found' })
  recordMetric(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RecordBookMetricDto,
    @Req() req: { user?: RouteSessionUser | null },
  ) {
    return this.booksService.recordMetric(id, dto.event, req.user);
  }

  @Get(':id/reading')
  @AllowAnonymous()
  @ApiOperation({
    summary: 'Get extracted reading document for Vigilia reader',
    description: 'Returns `{ bookId, pdfPages, ocrPending, chunks[] }` for published books or owner/admin private books.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'Extracted reading document' })
  @ApiNotFoundResponse({ description: 'Book or PDF not found' })
  getReading(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: RouteSessionUser | null },
  ) {
    return this.booksService.getReading(id, req.user);
  }

  @Get(':id/reading-state')
  @ApiSessionAuth()
  @ApiOperation({ summary: 'Get authenticated user’s saved reader marks, lexicon words, and progress' })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'Saved per-user reading state' })
  @ApiNotFoundResponse({ description: 'Book not found' })
  getReadingState(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: RouteSessionUser | null },
  ) {
    return this.booksService.getReadingState(id, req.user);
  }

  @Put(':id/reading-state')
  @ApiSessionAuth()
  @ApiOperation({ summary: 'Save authenticated user’s reader marks, lexicon words, and progress' })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'Updated per-user reading state' })
  @ApiBadRequestResponse({ description: 'Invalid reading state payload' })
  @ApiNotFoundResponse({ description: 'Book not found' })
  updateReadingState(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReadingStateDto,
    @Req() req: { user?: RouteSessionUser | null },
  ) {
    return this.booksService.updateReadingState(id, dto, req.user);
  }

  @Delete(':id')
  @ApiUserAuth()
  @ApiOperation({ summary: 'Delete a book and its stored PDF (owner or admin only)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'Deleted book' })
  @ApiNotFoundResponse({ description: 'Book not found' })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: RouteSessionUser | null },
  ) {
    return this.booksService.removeForUser(id, req.user);
  }
}
