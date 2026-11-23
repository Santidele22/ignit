import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Local-only credential store for `AUTH_MODE=dev` multi-account testing.
 * Registered exclusively in `DevAuthModule` so production (`DB_MODE=prod`,
 * `sync-schema.ts`) never creates or touches this table.
 */
@Entity({ name: 'dev_account' })
export class DevAccount {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ type: 'text', unique: true })
  email: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text' })
  passwordHash: string;
}
