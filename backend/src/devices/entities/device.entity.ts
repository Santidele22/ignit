import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type DevicePlatform =
  | 'desktop_linux'
  | 'desktop_win'
  | 'desktop_mac'
  | 'android'
  | 'ios';

@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'text' })
  userId: string;

  @Column({ type: 'varchar', length: 32 })
  platform: DevicePlatform;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text' })
  publicKeyPem: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: Date })
  lastSeenAt: Date;

  @Column({ type: Date, nullable: true })
  revokedAt?: Date | null;
}
