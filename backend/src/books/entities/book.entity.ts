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
import type { AiSafety, AiStatus } from '../ai/ai-analysis.types.js';

/** Every PDF upload starts in the review queue (S4). */
export const REVIEW_STATUS_PENDING = 'pending' as const;

/** Review states an admin (or the upload pipeline) can leave a book in. */
export const BOOK_REVIEW_STATUSES = [
  REVIEW_STATUS_PENDING,
  'approved',
  'rejected',
] as const;

export type BookReviewStatus = (typeof BOOK_REVIEW_STATUSES)[number];

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

  /** Page count the PDF firewall reported when the file was attached. */
  @Column({ type: 'int', nullable: true })
  filePages?: number | null;

  /** Size of the uploaded file in bytes. */
  @Column({ type: 'bigint', nullable: true })
  fileSize?: string | null;

  /** SHA-256 hex digest of the stored PDF bytes for duplicate detection. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  fileHash?: string | null;

  /** MIME type of the uploaded file (always application/pdf for now). */
  @Column({ type: 'text', nullable: true })
  mimeType?: string | null;

  /**
   * Admin review state (S4): `pending` until an admin accepts or rejects the
   * upload, so a new PDF never reaches the public surface on its own. The
   * default also backfills every row that existed before this column.
   */
  @Column({ type: 'varchar', length: 20, default: REVIEW_STATUS_PENDING })
  reviewStatus: BookReviewStatus;

  /** Optional admin note explaining the current decision. */
  @Column({ type: 'text', nullable: true })
  reviewNote?: string | null;

  /** Id of the admin that reviewed the upload. */
  @Column({ type: 'text', nullable: true })
  reviewedBy?: string | null;

  /** `Date` (not a literal name) so Postgres stores `timestamp` and the
   * SQLite dev/test database stores `datetime` without a per-driver branch. */
  @Column({ type: Date, nullable: true })
  reviewedAt?: Date | null;

  /**
   * Optional AI analysis (S3) of the extracted reading text. Every upload
   * records `aiStatus`, so the admin queue can tell "never analysed"
   * (`skipped`) apart from "analysed and clean" (`ok`).
   */
  @Column({ type: 'varchar', length: 10, nullable: true })
  aiSafety?: AiSafety | null;

  @Column({ type: 'int', nullable: true })
  aiQuality?: number | null;

  @Column({ type: 'text', nullable: true })
  aiNotes?: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  aiStatus?: AiStatus | null;

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
