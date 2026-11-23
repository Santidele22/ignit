import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RouteSessionUser } from '../../auth/guards/session-reader.js';
import { BooksService } from '../books.service.js';
import { assertCanManageBook } from '../lib/book-access.js';

/**
 * Runs before Multer's `FileInterceptor` on `POST /books/:id/file`, so
 * missing, private, or unowned books are rejected with 404/403 before any PDF
 * bytes are buffered to disk.
 */
@Injectable()
export class BookOwnerGuard implements CanActivate {
  constructor(private readonly booksService: BooksService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      params?: { id?: string };
      user?: RouteSessionUser | null;
    }>();
    const id = Number(request?.params?.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new NotFoundException('Book not found');
    }
    const book = await this.booksService.findOne(id);
    assertCanManageBook(book, request.user);
    return true;
  }
}
