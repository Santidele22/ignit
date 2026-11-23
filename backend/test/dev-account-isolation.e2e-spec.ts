import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

delete process.env.DATABASE_URL;
delete process.env.AUTH_MODE;
process.env.ALLOW_NO_AUTH = 'true';
process.env.NODE_ENV = 'test';

const { AppModule } = await import('../src/app.module.js');

describe('DevAccount isolation (e2e)', () => {
  it('does not register or create dev_account when AUTH_MODE is not dev', async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = mod.createNestApplication();
    await app.init();
    try {
      const ds = app.get(DataSource);
      const entities = ds.entityMetadatas.map((m) => m.tableName);
      const tables = (
        await ds.query("SELECT name FROM sqlite_master WHERE type='table'")
      ).map((r: { name: string }) => r.name);

      expect(entities).not.toContain('dev_account');
      expect(tables).not.toContain('dev_account');
    } finally {
      await app.close();
    }
  });
});
