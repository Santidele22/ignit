import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasPdfMagicBytes } from './pdf.util.js';

describe('hasPdfMagicBytes', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pdf-util-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function write(name: string, content: string | Buffer) {
    const path = join(dir, name);
    await writeFile(path, content);
    return path;
  }

  it('accepts a file starting with the %PDF- magic bytes', async () => {
    const path = await write('book.pdf', '%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

    await expect(hasPdfMagicBytes(path)).resolves.toBe(true);
  });

  it('rejects plain text even when the client sends a PDF mimetype', async () => {
    const path = await write('spoofed.pdf', 'hello, not a pdf');

    await expect(hasPdfMagicBytes(path)).resolves.toBe(false);
  });

  it('rejects binaries with no PDF header', async () => {
    const path = await write('binary.pdf', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]));

    await expect(hasPdfMagicBytes(path)).resolves.toBe(false);
  });

  it('rejects an empty file and a file shorter than the magic bytes', async () => {
    const empty = await write('empty.pdf', '');
    const short = await write('short.pdf', '%PDF');

    await expect(hasPdfMagicBytes(empty)).resolves.toBe(false);
    await expect(hasPdfMagicBytes(short)).resolves.toBe(false);
  });

  it('rejects a missing file', async () => {
    await expect(hasPdfMagicBytes(join(dir, 'missing.pdf'))).resolves.toBe(false);
  });
});
