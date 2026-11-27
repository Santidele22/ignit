import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('licenses')
@Unique(['userId', 'bookId', 'deviceId'])
export class License {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'text' })
  userId: string;

  @Index()
  @Column({ type: 'int' })
  bookId: number;

  @Index()
  @Column({ type: 'text' })
  deviceId: string;

  /** Base64 RSA-OAEP-SHA256 wrapped 32-byte CEK, decryptable only by this device's private key. */
  @Column({ type: 'text' })
  wrappedCek: string;

  @CreateDateColumn()
  issuedAt: Date;

  @Column({ type: Date, nullable: true })
  expiresAt?: Date | null;

  @Column({ type: Date, nullable: true })
  revokedAt?: Date | null;

  @Column({ type: 'varchar', length: 128 })
  signature: string;
}

@Entity('book_entitlements')
@Unique(['userId', 'bookId'])
export class BookEntitlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'text' })
  userId: string;

  @Index()
  @Column({ type: 'int' })
  bookId: number;

  @CreateDateColumn()
  grantedAt: Date;

  @Column({ type: Date, nullable: true })
  expiresAt?: Date | null;

  @Column({ type: Date, nullable: true })
  revokedAt?: Date | null;
}
