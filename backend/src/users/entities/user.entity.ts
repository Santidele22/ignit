import { Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { isAuthEnabled } from '../../auth/auth-enabled.js';
import { Book } from '../../books/entities/book.entity.js';
import { ReadingState } from '../../books/entities/reading-state.entity.js';

/**
 * Maps the Better Auth `user` table for domain relations (`Book.owner`,
 * `ReadingState.user`). When Better Auth owns the PostgreSQL identity tables,
 * TypeORM leaves `user` synchronization off (`run-auth-migrations.ts` owns DDL).
 * On SQLite (local dev / tests) TypeORM creates the table directly.
 */
@Entity({ name: 'user', synchronize: !isAuthEnabled })
export class User {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', unique: true })
  email: string;

  @Column({ default: false })
  emailVerified: boolean;

  @Column({ type: 'text', nullable: true })
  role?: string | null;

  @OneToMany(() => Book, (book) => book.owner)
  books: Book[];

  @OneToMany(() => ReadingState, (readingState) => readingState.user)
  readingStates: ReadingState[];
}
