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
    status: ReadingStatus.QUEUED,
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
    status: row.status ?? ReadingStatus.QUEUED,
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

  return { ...state, status };
}

/** Overlays the sent slices onto the stored state, copying every nested object. */
export function mergeReadingState(
  bookId: number,
  dto: UpdateReadingStateDto,
  current: BookReadingState,
): BookReadingState {
  return {
    bookId: String(bookId),
    status: current.status ?? ReadingStatus.QUEUED,
    progress: dto.progress
      ? {
          page: dto.progress.page,
          pct: dto.progress.pct,
          ...(dto.progress.chunkId !== undefined ? { chunkId: dto.progress.chunkId } : {}),
        }
      : current.progress,
    marks: dto.marks
      ? dto.marks.map((m) => ({
          id: m.id,
          kind: m.kind,
          anchor: m.anchor,
          ...(m.ink !== undefined ? { ink: m.ink } : {}),
          ...(m.text !== undefined ? { text: m.text } : {}),
          ...(m.note !== undefined ? { note: m.note } : {}),
        }))
      : current.marks,
    words: dto.words
      ? dto.words.map((w) => ({
          term: w.term,
          ...(w.trans !== undefined ? { trans: w.trans } : {}),
          ...(w.anchor !== undefined ? { anchor: w.anchor } : {}),
        }))
      : current.words,
  };
}

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
