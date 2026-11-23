import { PartialType } from '@nestjs/swagger';
import { CreateBookDto } from './create-book.dto.js';

/**
 * Body of `PATCH /books/:id`: a partial merge of `CreateBookDto`, so the
 * admin panel sends only the columns the editor touched.
 */
export class UpdateBookDto extends PartialType(CreateBookDto) {}
