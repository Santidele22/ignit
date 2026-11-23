import type { Repository } from 'typeorm';
import { ReadingStatus } from '../../common/enums/reading-status.enum.js';
import type { UpdateReadingStateDto } from '../dto/update-reading-state.dto.js';
import type { ReadingState } from '../entities/reading-state.entity.js';
import type {
  BookReadingState,
  ReadingMark,
  ReadingProgress,
  ReadingWord,
} from '../reading/book-reading.extractor.js';

export function defaultReadingState(bookId: number): BookReadingState {
  return {
    bookId: String(bookId),
    marks: [],
    words: [],
    progress: { page: 1, pct: 0 },
  };
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function rowToReadingState(
  bookId: number,
  row: ReadingState | null | undefined,
): BookReadingState {
  if (!row) {
    return defaultReadingState(bookId);
  }
  const progress = parseJson<Partial<ReadingProgress>>(row.progressJson, {});
  const marks = parseJson<unknown>(row.marksJson, []);
  const words = parseJson<unknown>(row.wordsJson, []);

  return {
    bookId: String(bookId),
    progress:
      typeof progress.page === 'number' && typeof progress.pct === 'number'
        ? {
            page: progress.page,
            pct: progress.pct,
            ...(typeof progress.chunkId === 'string' ? { chunkId: progress.chunkId } : {}),
          }
        : { page: 1, pct: 0 },
    marks: Array.isArray(marks) ? (marks as ReadingMark[]) : [],
    words: Array.isArray(words) ? (words as ReadingWord[]) : [],
  };
}

export async function readUserReadingState(
  readingStatesRepository: Repository<ReadingState>,
  bookId: number,
  userId: string,
): Promise<BookReadingState> {
  const row = await readingStatesRepository.findOne({ where: { bookId, userId } });
  return rowToReadingState(bookId, row);
}

export async function persistUserReadingState(
  readingStatesRepository: Repository<ReadingState>,
  bookId: number,
  userId: string,
  state: BookReadingState,
  status: ReadingStatus,
  existingRow?: ReadingState | null,
): Promise<BookReadingState> {
  const row =
    existingRow ??
    (await readingStatesRepository.findOne({ where: { bookId, userId } })) ??
    readingStatesRepository.create({ bookId, userId, status });

  row.progressJson = JSON.stringify(state.progress);
  row.marksJson = JSON.stringify(state.marks);
  row.wordsJson = JSON.stringify(state.words);
  row.status = status;

  try {
    await readingStatesRepository.save(row);
  } catch (error) {
    // Handle concurrent first-save race on unique (userId, bookId).
    const raced = await readingStatesRepository.findOne({ where: { bookId, userId } });
    if (!raced) {
      throw error;
    }
    raced.progressJson = row.progressJson;
    raced.marksJson = row.marksJson;
    raced.wordsJson = row.wordsJson;
    raced.status = status;
    await readingStatesRepository.save(raced);
  }

  return state;
}

/** Overlays the sent slices onto the stored state, copying every nested object. */
export function mergeReadingState(
  bookId: number,
  dto: UpdateReadingStateDto,
  current: BookReadingState,
): BookReadingState {
  return {
    bookId: String(bookId),
    progress: dto.progress ? { ...dto.progress } : current.progress,
    marks: dto.marks ? dto.marks.map((m) => ({ ...m })) : current.marks,
    words: dto.words ? dto.words.map((w) => ({ ...w })) : current.words,
  };
}

/**
 * Progress at 100% closes the book; starting to read a queued one moves it to
 * `reading`; every other combination keeps the stored status.
 */
export function readingStatusAfter(
  current: ReadingStatus,
  dto: UpdateReadingStateDto,
): ReadingStatus {
  const reportedPct = dto.progress?.pct;
  if (reportedPct !== undefined && reportedPct >= 100) {
    return ReadingStatus.FINISHED;
  }
  return current === ReadingStatus.QUEUED ? ReadingStatus.READING : current;
}
