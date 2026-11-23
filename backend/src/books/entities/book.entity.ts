import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BookKind } from '../../common/enums/book-kind.enum.js';
import { ReadingStatus } from '../../common/enums/reading-status.enum.js';
import { User } from '../../users/entities/user.entity.js';

/**
 * One entry of the landing "lectura" block: what the owner is reading, with an
 * optional review and (from T2) the PDF file the visitors can download through
 * the rate-limited endpoint.
 *
 * `published` guards the public surface: only published books render on the
 * landing and answer the download endpoint, while every row keeps showing in
 * the admin panel the way the other portfolio entities do.
 */
@Entity('books')
export class Book {
  @PrimaryGeneratedColumn()
  id: number;

  /** Book name shown as the card title. */
  @Column({ type: 'text' })
  title: string;

  /** Author name shown under the title. */
  @Column({ type: 'text' })
  author: string;

  /** One-paragraph description rendered on the admin and landing card. */
  @Column({ type: 'text' })
  description: string;

  /** Where the owner stands: `reading`, `finished` or `queued`. */
  @Column({ type: 'varchar', length: 20, enum: ReadingStatus })
  status: ReadingStatus;

  /** Which landing shelf the book renders on: `tecnico` or `no_tecnico`.
   * Defaults to `no_tecnico`, so existing rows and creates without an
   * explicit kind stay out of the technical shelf (issue 23). */
  @Column({ type: 'varchar', length: 20, enum: BookKind, default: BookKind.NO_TECNICO })
  kind: BookKind;

  /** Optional review or comment rendered with the book on the landing. */
  @Column({ type: 'text', nullable: true })
  review?: string | null;

  /**
   * Publishing flag: `true` renders the book on the landing (and enables the
   * download endpoint). Nullable so unpublished drafts stay out of the
   * public queries without an explicit false.
   */
  @Column({ type: 'boolean', default: false })
  published: boolean;

  /** On-disk path of the uploaded PDF (under BOOKS_UPLOAD_DIR). Null until a
   * file is uploaded. */
  @Column({ type: 'text', nullable: true })
  filePath?: string | null;

  /** Original filename reported by the client at upload time. */
  @Column({ type: 'text', nullable: true })
  originalName?: string | null;

  /** Size of the uploaded file in bytes. */
  @Column({ type: 'bigint', nullable: true })
  fileSize?: string | null;

  /** MIME type of the uploaded file (always application/pdf for now). */
  @Column({ type: 'text', nullable: true })
  mimeType?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => User, (user) => user.books, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'ownerId' })
  owner: User | null;

  @Column({ type: 'text' })
  ownerId: string;
}
