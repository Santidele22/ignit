import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3BookStorage } from './s3-book.storage.js';

/**
 * `S3BookStorage` talks to the private Neon Object Storage bucket through
 * the AWS SDK. The SDK is mocked here so the suite runs offline while still
 * asserting the exact commands (bucket, key, body, path-style client) and
 * the temp-file lifecycle the service relies on.
 */
const aws = vi.hoisted(() => {
  return {
    send: vi.fn(),
    getSignedUrl: vi.fn(),
    instances: [] as unknown[],
  };
});

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    constructor(public readonly config: unknown) {
      aws.instances.push(config);
    }
    send(command: unknown): Promise<unknown> {
      return aws.send(command);
    }
  }
  class PutObjectCommand {
    constructor(public readonly input: unknown) {}
  }
  class GetObjectCommand {
    constructor(public readonly input: unknown) {}
  }
  class DeleteObjectCommand {
    constructor(public readonly input: unknown) {}
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: aws.getSignedUrl,
}));

const env = {
  BOOKS_STORAGE: 's3',
  AWS_ACCESS_KEY_ID: 'test-access-key',
  AWS_SECRET_ACCESS_KEY: 'test-secret-key',
  AWS_ENDPOINT_URL_S3: 'https://s3.example.test',
  AWS_REGION: 'us-east-2',
  BOOKS_S3_BUCKET: 'books',
};

describe('S3BookStorage', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'books-s3-'));
    aws.send.mockReset();
    aws.getSignedUrl.mockReset();
    aws.instances.length = 0;
    aws.getSignedUrl.mockResolvedValue('https://signed.example/url');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('fails closed at construction when the AWS variables are missing', () => {
    expect(() => new S3BookStorage({ ...env, AWS_ENDPOINT_URL_S3: '' })).toThrow(
      /BOOKS_STORAGE=s3 requires/,
    );
    expect(() => new S3BookStorage({ ...env, AWS_ACCESS_KEY_ID: '' })).toThrow(
      /BOOKS_STORAGE=s3 requires/,
    );
    expect(() => new S3BookStorage({ ...env, AWS_SECRET_ACCESS_KEY: '' })).toThrow(
      /BOOKS_STORAGE=s3 requires/,
    );
  });

  it('builds a path-style client with the branch endpoint, region and credentials', () => {
    new S3BookStorage(env);

    expect(aws.instances).toHaveLength(1);
    expect(aws.instances[0]).toMatchObject({
      forcePathStyle: true,
      endpoint: 'https://s3.example.test',
      region: 'us-east-2',
      credentials: {
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key',
      },
    });
  });

  it('uploads the PDF bytes and deletes the temp copy, returning the object key', async () => {
    const tempPath = join(dir, 'multer-temp.pdf');
    const bytes = Buffer.from('%PDF-1.4\ns3-upload\n');
    await writeFile(tempPath, bytes);
    aws.send.mockResolvedValue({});

    const storage = new S3BookStorage(env);
    const ref = await storage.persist(7, { path: tempPath, size: bytes.length, mimetype: 'application/pdf' });

    expect(ref).toMatch(/^\d+-[0-9a-f]{12}\.pdf$/);
    expect(aws.send).toHaveBeenCalledTimes(1);
    const command = aws.send.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(command.input.Bucket).toBe('books');
    expect(command.input.Key).toBe(ref);
    expect(command.input.Body).toEqual(bytes);
    expect(command.input.ContentType).toBe('application/pdf');
    await expect(access(tempPath)).rejects.toThrow();
  });

  it('derives the object key extension from the mime type (EPUB keeps its own suffix)', async () => {
    const tempPath = join(dir, 'multer-temp.epub');
    const bytes = Buffer.from('PK\u0003\u0004epub-bytes');
    await writeFile(tempPath, bytes);
    aws.send.mockResolvedValue({});

    const storage = new S3BookStorage(env);
    const ref = await storage.persist(7, {
      path: tempPath,
      size: bytes.length,
      mimetype: 'application/epub+zip',
    });

    expect(ref).toMatch(/^\d+-[0-9a-f]{12}\.epub$/);
    const command = aws.send.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(command.input.Key).toBe(ref);
    expect(command.input.ContentType).toBe('application/epub+zip');
  });

  it('keeps the temp file when the upload fails so the caller can clean up', async () => {
    const tempPath = join(dir, 'multer-temp.pdf');
    await writeFile(tempPath, '%PDF-1.4\n');
    aws.send.mockRejectedValue(new Error('S3 unavailable'));

    const storage = new S3BookStorage(env);

    await expect(
      storage.persist(7, { path: tempPath, size: 9, mimetype: 'application/pdf' }),
    ).rejects.toThrow('S3 unavailable');
    await expect(access(tempPath)).resolves.toBeUndefined();
  });

  it('resolves downloads to a short-lived presigned URL of the private object', async () => {
    const storage = new S3BookStorage(env);

    const download = await storage.resolveDownload('1792425977103-708232007.pdf');

    expect(download).toEqual({ strategy: 's3', url: 'https://signed.example/url' });
    const command = aws.getSignedUrl.mock.calls[0]![1] as { input: Record<string, unknown> };
    expect(command.input.Bucket).toBe('books');
    expect(command.input.Key).toBe('1792425977103-708232007.pdf');
    expect(aws.getSignedUrl.mock.calls[0]![2]).toEqual({ expiresIn: 120 });
  });

  it('honours BOOKS_DOWNLOAD_URL_TTL for the signed URL lifetime', async () => {
    const storage = new S3BookStorage({ ...env, BOOKS_DOWNLOAD_URL_TTL: '30' });

    await storage.resolveDownload('some-key.pdf');

    expect(aws.getSignedUrl.mock.calls[0]![2]).toEqual({ expiresIn: 30 });
  });

  it('falls back to the 120s TTL when BOOKS_DOWNLOAD_URL_TTL is not a positive number', async () => {
    const storage = new S3BookStorage({ ...env, BOOKS_DOWNLOAD_URL_TTL: '-5' });

    await storage.resolveDownload('some-key.pdf');

    expect(aws.getSignedUrl.mock.calls[0]![2]).toEqual({ expiresIn: 120 });
  });

  it('deletes objects best-effort, swallowing storage errors', async () => {
    aws.send.mockRejectedValue(new Error('NoSuchKey'));
    const storage = new S3BookStorage(env);

    await expect(storage.remove('gone.pdf')).resolves.toBeUndefined();
    await expect(storage.remove(null)).resolves.toBeUndefined();

    const command = aws.send.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(command.input).toEqual({ Bucket: 'books', Key: 'gone.pdf' });
  });
});
