import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Book } from '../books/entities/book.entity.js';
import { ReadingState } from '../books/entities/reading-state.entity.js';
import { BooksModule } from '../books/books.module.js';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Book, ReadingState]), BooksModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
