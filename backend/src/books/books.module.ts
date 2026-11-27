import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity.js';
import { BooksAdminController } from './admin/books-admin.controller.js';
import { AiStyleReferenceController } from './admin/ai-style-reference.controller.js';
import { BooksAdminService } from './admin/books-admin.service.js';
import { BooksController } from './books.controller.js';
import { BooksService } from './books.service.js';
import { Book } from './entities/book.entity.js';
import { DownloadEvent } from './entities/download-event.entity.js';
import { ReadingState } from './entities/reading-state.entity.js';
import { BookOwnerGuard } from './guards/book-owner.guard.js';
import { BOOK_STORAGE, createBookStorage } from './storage/book-storage.js';

@Module({
  imports: [TypeOrmModule.forFeature([Book, DownloadEvent, ReadingState, User])],
  controllers: [BooksController, BooksAdminController, AiStyleReferenceController],
  providers: [
    BooksService,
    BooksAdminService,
    BookOwnerGuard,
    {
      provide: BOOK_STORAGE,
      useFactory: () => createBookStorage(process.env),
    },
  ],
  exports: [BOOK_STORAGE],
})
export class BooksModule {}
