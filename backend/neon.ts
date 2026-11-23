import { defineConfig } from '@neon/config/v1';

export default defineConfig({
  // Managed Better Auth on the Ignit Neon project.
  auth: true,
  // Private Neon Object Storage bucket for PDFs and `reading.json` sidecars
  // (no external Cloudflare R2 or AWS S3). The backend (`BOOKS_STORAGE=s3`,
  // `BOOKS_S3_BUCKET=books`) receives `AWS_ACCESS_KEY_ID`,
  // `AWS_SECRET_ACCESS_KEY`, and `AWS_ENDPOINT_URL_S3` via `neon env pull`.
  buckets: {
    books: {},
  },
  branch: (branch) => {
    if (branch.isDefault) {
      return {};
    }
    if (!branch.exists) {
      return { ttl: '7d' };
    }
    return {};
  },
});
