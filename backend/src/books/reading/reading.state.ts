import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BookReadingDocument, BookReadingState } from './reading.types.js';

function resolveUploadDir(): string {
  return process.env.BOOKS_UPLOAD_DIR ?? 'uploads/books';
}

export function readingJsonPath(bookId: number): string {
  return join(resolveUploadDir(), String(bookId), 'reading.json');
}

export function readingDeterministicJsonPath(bookId: number): string {
  return join(resolveUploadDir(), String(bookId), 'reading.deterministic.json');
}

export function readingStatePath(bookId: number): string {
  return join(resolveUploadDir(), String(bookId), 'state.json');
}

export async function writeBookReadingJson(
  bookId: number,
  doc: BookReadingDocument,
): Promise<void> {
  const target = readingJsonPath(bookId);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(doc, null, 2), 'utf8');
}

export async function readBookReadingJson(
  bookId: number,
): Promise<BookReadingDocument | null> {
  try {
    const raw = await readFile(readingJsonPath(bookId), 'utf8');
    return JSON.parse(raw) as BookReadingDocument;
  } catch {
    return null;
  }
}

export async function writeBookDeterministicReadingJson(
  bookId: number,
  doc: BookReadingDocument,
): Promise<void> {
  const target = readingDeterministicJsonPath(bookId);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(doc, null, 2), 'utf8');
}

export async function readBookDeterministicReadingJson(
  bookId: number,
): Promise<BookReadingDocument | null> {
  try {
    const raw = await readFile(readingDeterministicJsonPath(bookId), 'utf8');
    return JSON.parse(raw) as BookReadingDocument;
  } catch {
    return null;
  }
}

export async function readBookReadingState(bookId: number): Promise<BookReadingState> {
  try {
    const raw = await readFile(readingStatePath(bookId), 'utf8');
    const parsed = JSON.parse(raw) as Partial<BookReadingState>;
    return {
      bookId: String(bookId),
      marks: Array.isArray(parsed.marks) ? parsed.marks : [],
      words: Array.isArray(parsed.words) ? parsed.words : [],
      progress:
        parsed.progress &&
        typeof parsed.progress.page === 'number' &&
        typeof parsed.progress.pct === 'number'
          ? parsed.progress
          : { page: 1, pct: 0 },
    };
  } catch {
    return {
      bookId: String(bookId),
      marks: [],
      words: [],
      progress: { page: 1, pct: 0 },
    };
  }
}

export async function writeBookReadingState(
  bookId: number,
  state: BookReadingState,
): Promise<BookReadingState> {
  const target = readingStatePath(bookId);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(state, null, 2), 'utf8');
  return state;
}

export async function removeBookReadingArtifacts(bookId: number): Promise<void> {
  const dir = join(resolveUploadDir(), String(bookId));
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}
