import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PdfFirewallReport } from '../pdf-firewall/pdf-firewall.types.js';
import type { BookStorage } from '../storage/book-storage.js';
import { firewallJsonKey } from './book-sidecar-keys.js';

/**
 * Per-book firewall pipeline report sidecar (S2): the `PdfFirewallReport`
 * produced at upload time is written next to `reading.json` — local disk for
 * the `local` strategy and the JSON sidecar store for `s3`. Rejected uploads
 * persist the same report even though their file is dropped, so the /admin
 * pipeline view can explain every refusal.
 */
function resolveUploadDir(): string {
  return process.env.BOOKS_UPLOAD_DIR ?? 'uploads/books';
}

export function firewallJsonPath(bookId: number): string {
  return join(resolveUploadDir(), String(bookId), 'firewall.json');
}

export async function saveBookFirewallReport(
  bookId: number,
  report: PdfFirewallReport,
  bookStorage: Pick<BookStorage, 'strategy' | 'putJson'>,
): Promise<void> {
  const serialized = JSON.stringify(report, null, 2);
  const target = firewallJsonPath(bookId);
  await mkdir(dirname(target), { recursive: true })
    .then(() => writeFile(target, serialized, 'utf8'))
    .catch(() => undefined);
  if (bookStorage.putJson) {
    await bookStorage.putJson(firewallJsonKey(bookId), report).catch(() => undefined);
  }
}

/** Reads the report back: local file first, then the stored sidecar. */
export async function loadBookFirewallReport(
  bookId: number,
  bookStorage: Pick<BookStorage, 'strategy' | 'getJson'>,
): Promise<PdfFirewallReport | null> {
  const local = await readLocalFirewallJson(bookId);
  if (local) {
    return local;
  }
  if (bookStorage.getJson) {
    const stored = await bookStorage
      .getJson<PdfFirewallReport>(firewallJsonKey(bookId))
      .catch(() => null);
    if (isFirewallReport(stored)) {
      return stored;
    }
  }
  return null;
}

/** Best-effort removal of both copies (local file and stored sidecar). */
export async function removeBookFirewallReport(
  bookId: number,
  bookStorage: Pick<BookStorage, 'remove'>,
): Promise<void> {
  await rm(firewallJsonPath(bookId), { force: true }).catch(() => undefined);
  await bookStorage.remove(firewallJsonKey(bookId)).catch(() => undefined);
}

async function readLocalFirewallJson(bookId: number): Promise<PdfFirewallReport | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(firewallJsonPath(bookId), 'utf8'));
    return isFirewallReport(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isFirewallReport(value: unknown): value is PdfFirewallReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1 &&
    Array.isArray((value as { tiers?: unknown }).tiers) &&
    typeof (value as { safe?: unknown }).safe === 'boolean'
  );
}
