import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One row per downloaded PDF, used to enforce the per-IP daily rate limit
 * on `GET /books/:id/download`. Only the IP and the book are stored; no
 * personal data beyond the address the request came from.
 */
@Entity('download_events')
export class DownloadEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  ip: string;

  @Column({ type: 'int' })
  bookId: number;

  @CreateDateColumn()
  createdAt: Date;
}