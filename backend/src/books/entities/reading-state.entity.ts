import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ReadingStatus } from '../../common/enums/reading-status.enum.js';
import { User } from '../../users/entities/user.entity.js';
import { Book } from './book.entity.js';

/**
 * Per-user, per-book Vigilia reading progress, annotations and lexicon.
 * Uses plain `text` JSON columns for dialect parity across SQLite and Postgres.
 */
@Entity('reading_states')
@Unique(['userId', 'bookId'])
export class ReadingState {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  userId: string;

  @ManyToOne(() => User, (user) => user.readingStates, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  @Column({ type: 'int' })
  bookId: number;

  @ManyToOne(() => Book, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'bookId' })
  book: Book | null;

  @Column({ type: 'text', nullable: true })
  progressJson?: string | null;

  @Column({ type: 'text', nullable: true })
  marksJson?: string | null;

  @Column({ type: 'text', nullable: true })
  wordsJson?: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    enum: ReadingStatus,
    default: ReadingStatus.QUEUED,
  })
  status: ReadingStatus;

  @UpdateDateColumn()
  updatedAt: Date;
}
