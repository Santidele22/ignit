import { randomBytes } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { BookStorage, BookDownload } from './book-storage.js';
import { EPUB_MIME_TYPE } from '../pdf.util.js';

/** Fallback region for Neon Object Storage (aws-us-east-2). */
const DEFAULT_REGION = 'us-east-2';

/** Presigned download URL lifetime: short by default so a leaked URL dies fast. */
const DEFAULT_DOWNLOAD_URL_TTL_SECONDS = 120;

function resolveUrlTtlSeconds(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_DOWNLOAD_URL_TTL_SECONDS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DOWNLOAD_URL_TTL_SECONDS;
}

/**
 * Object-key suffix for the stored bytes (S6): EPUBs keep a `.epub` suffix and
 * everything else — including every existing PDF — keeps the historical `.pdf`
 * default, so no already-stored key changes.
 */
export function objectKeyExtension(mimetype: string): string {
  return mimetype.split(';')[0]?.trim().toLowerCase() === EPUB_MIME_TYPE ? '.epub' : '.pdf';
}

/**
 * S3 client for the branch's Neon Object Storage: path-style addressing
 * (`forcePathStyle: true`, required by Neon) with the AWS-standard
 * credential env vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
 * `AWS_ENDPOINT_URL_S3`, `AWS_REGION`). Shared by the runtime storage and
 * the one-time migration script so both speak to the bucket the same way.
 */
export function createS3Client(env: NodeJS.ProcessEnv = process.env): S3Client {
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  const endpoint = env.AWS_ENDPOINT_URL_S3;
  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error(
      'BOOKS_STORAGE=s3 requires AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_ENDPOINT_URL_S3',
    );
  }
  return new S3Client({
    region: env.AWS_REGION ?? DEFAULT_REGION,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

/**
 * Production storage on Neon Object Storage: the branch's private S3
 * bucket. `books.filePath` holds the object key (never the bytes), uploads
 * go through `PutObject` before the row is updated and downloads redirect
 * to a short-lived presigned URL, so the bucket stays private while the
 * public endpoint keeps its rate limit and publication checks.
 *
 * The client uses path-style addressing (`forcePathStyle: true`, required
 * by Neon) and the AWS-standard credential env vars the branch injects.
 */
export class S3BookStorage implements BookStorage {
  readonly strategy = 's3' as const;
  readonly bucket: string;
  private readonly client: S3Client;
  private readonly urlTtlSeconds: number;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.bucket = env.BOOKS_S3_BUCKET ?? 'books';
    this.urlTtlSeconds = resolveUrlTtlSeconds(env.BOOKS_DOWNLOAD_URL_TTL);
    this.client = createS3Client(env);
  }

  async persist(
    _bookId: number,
    file: { path: string; mimetype: string },
  ): Promise<string> {
    const stem = `${Date.now()}-${randomBytes(6).toString('hex')}`;
    const key = `${stem}${objectKeyExtension(file.mimetype)}`;
    // Read into memory instead of streaming so the SDK sends a known
    // Content-Length; uploads are capped at BOOKS_MAX_FILE_SIZE (50 MiB),
    // which a buffer comfortably fits.
    const body = await readFile(file.path);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: file.mimetype,
      }),
    );
    // The bytes live in the bucket now; the local temp copy is deleted so
    // the Render disk (ephemeral and tiny on the free plan) never fills.
    await unlink(file.path).catch(() => undefined);
    return key;
  }

  async remove(ref: string | null | undefined): Promise<void> {
    if (!ref) return;
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: ref }),
      );
    } catch {
      // Best effort: the row update must not fail on a cleanup miss.
    }
  }

  async resolveDownload(ref: string): Promise<BookDownload> {
    // Never called with a falsy ref: the service checks the column first.
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: ref }),
      { expiresIn: this.urlTtlSeconds },
    );
    return { strategy: 's3', url };
  }

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = res.Body as { transformToString?: (enc?: string) => Promise<string> } | undefined;
      if (!body || typeof body.transformToString !== 'function') return null;
      const raw = await body.transformToString('utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async putJson(key: string, data: unknown): Promise<void> {
    const body = Buffer.from(JSON.stringify(data), 'utf-8');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/json; charset=utf-8',
      }),
    );
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
      if (!body || typeof body.transformToByteArray !== 'function') return null;
      return Buffer.from(await body.transformToByteArray());
    } catch {
      return null;
    }
  }

  async putBuffer(
    key: string,
    data: Buffer,
    options?: { contentType?: string; cacheControl?: string },
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: options?.contentType ?? 'application/octet-stream',
        ...(options?.cacheControl ? { CacheControl: options.cacheControl } : {}),
      }),
    );
  }

  async resolveUpload(
    key: string,
    contentType = 'application/vnd.ignit.igb1',
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: this.urlTtlSeconds },
    );
  }
}
