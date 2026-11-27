import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Book } from '../books/entities/book.entity.js';
import { Device } from '../devices/entities/device.entity.js';
import { BookEntitlement, License } from './entities/license.entity.js';
import { LicensesController } from './licenses.controller.js';
import { LicensesService } from './licenses.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([License, BookEntitlement, Device, Book])],
  controllers: [LicensesController],
  providers: [LicensesService],
  exports: [LicensesService],
})
export class LicensesModule {}
