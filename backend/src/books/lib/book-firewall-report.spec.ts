import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BookStorage } from '../storage/book-storage.js';
import type { PdfFirewallReport } from '../pdf-firewall/pdf-firewall.types.js';
import {
  firewallJsonPath,
  loadBookFirewallReport,
  saveBookFirewallReport,
} from './book-firewall-report.js';
import { firewallJsonKey } from './book-sidecar-keys.js';

const sampleReport: PdfFirewallReport = {
  schemaVersion: 1,
  safe: false,
  pageCount: 0,
  violations: [{ code: 'ACTIVE_CONTENT_KEY', detail: '/JavaScript' }],
  tiers: [
    {
      index: 0,
      name: 'header',
      status: 'passed',
      checks: [
        { id: 'header', status: 'passed', violations: [] },
        { id: 'polyglot', status: 'passed', violations: [] },
      ],
    },
    {
      index: 1,
      name: 'lexical',
      status: 'violation',
      checks: [
        {
          id: 'active-content',
          status: 'violation',
          violations: [{ code: 'ACTIVE_CONTENT_KEY', detail: '/JavaScript' }],
        },
        { id: 'encryption', status: 'passed', violations: [] },
      ],
    },
    {
      index: 2,
      name: 'structure',
      status: 'skipped',
      checks: [
        { id: 'parse', status: 'skipped', violations: [] },
        { id: 'encryption', status: 'skipped', violations: [] },
        { id: 'active-content', status: 'skipped', violations: [] },
        { id: 'external-streams', status: 'skipped', violations: [] },
        { id: 'uris', status: 'skipped', violations: [] },
        { id: 'metadata', status: 'skipped', violations: [] },
        { id: 'resource-limits', status: 'skipped', violations: [] },
        { id: 'page-count', status: 'skipped', violations: [] },
        { id: 'hidden-content', status: 'skipped', violations: [] },
      ],
    },
  ],
};

describe('book firewall report sidecar', () => {
  let dir: string;
  let previousUploadDir: string | undefined;

  beforeEach(() => {
    previousUploadDir = process.env.BOOKS_UPLOAD_DIR;
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'firewall-report-'));
    process.env.BOOKS_UPLOAD_DIR = dir;
  });

  afterEach(async () => {
    if (previousUploadDir === undefined) {
      delete process.env.BOOKS_UPLOAD_DIR;
    } else {
      process.env.BOOKS_UPLOAD_DIR = previousUploadDir;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips the report through the local sidecar file', async () => {
    await saveBookFirewallReport(7, sampleReport, {
      strategy: 'local',
    } as BookStorage);
    const loaded = await loadBookFirewallReport(7, { strategy: 'local' } as BookStorage);

    expect(loaded).toEqual(sampleReport);
  });

  it('answers null when no report was ever stored', async () => {
    const loaded = await loadBookFirewallReport(999, { strategy: 'local' } as BookStorage);

    expect(loaded).toBeNull();
  });

  it('falls back to the JSON sidecar storage when the local read misses', async () => {
    const storage = {
      strategy: 's3',
      getJson: async (key: string) =>
        key === firewallJsonKey(7) ? sampleReport : null,
      putJson: async () => undefined,
    } as unknown as BookStorage;

    await saveBookFirewallReport(7, sampleReport, storage);
    const loaded = await loadBookFirewallReport(7, { strategy: 's3' } as BookStorage);

    expect(loaded).toEqual(sampleReport);
  });

  it('exposes the deterministic local path next to reading.json', () => {
    expect(firewallJsonPath(12)).toBe(join(process.env.BOOKS_UPLOAD_DIR as string, '12', 'firewall.json'));
  });
});
