import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalBookStorage } from './local-book.storage.js';

/**
 * Local storage keeps the historical layout: multer already wrote the file
 * under the upload dir, `persist` returns that same path and `resolveDownload`
 * streams it — answering a controlled 404 when the file is gone, so the
 * download endpoint never crashes on a vanished upload.
 */
describe('LocalBookStorage', () => {
  let dir: string;
  let storage: LocalBookStorage;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'books-local-'));
    storage = new LocalBookStorage({ BOOKS_UPLOAD_DIR: dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps the multer file in place and stores its path as the reference', async () => {
    const filePath = join(dir, '1792425977103-708232007.pdf');
    await writeFile(filePath, '%PDF-1.4\n');

    const ref = await storage.persist(7, { path: filePath, size: 9, mimetype: 'application/pdf' });

    expect(ref).toBe(filePath);
    await expect(access(filePath)).resolves.toBeUndefined();
  });

  it('resolves a download to a readable stream of the stored file', async () => {
    const filePath = join(dir, '1792425977103-708232007.pdf');
    const bytes = Buffer.from('%PDF-1.4\nhello\n');
    await writeFile(filePath, bytes);

    const download = await storage.resolveDownload(filePath);

    expect(download.strategy).toBe('local');
    if (download.strategy !== 'local') throw new Error('unreachable');
    const chunks: Buffer[] = [];
    for await (const chunk of download.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(bytes);
    download.stream.destroy();
  });

  it('answers NotFoundException for a missing file instead of a raw stream error', async () => {
    const missing = join(dir, 'never-uploaded.pdf');

    await expect(storage.resolveDownload(missing)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removes a stored file best-effort, ignoring missing references', async () => {
    const filePath = join(dir, 'to-delete.pdf');
    await writeFile(filePath, '%PDF-1.4\n');

    await storage.remove(filePath);
    await expect(access(filePath)).rejects.toThrow();

    await expect(storage.remove(join(dir, 'absent.pdf'))).resolves.toBeUndefined();
    await expect(storage.remove(null)).resolves.toBeUndefined();
    await expect(storage.remove(undefined)).resolves.toBeUndefined();
  });
});
