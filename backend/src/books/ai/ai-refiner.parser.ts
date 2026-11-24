import type {
  BookReadingDocument,
  ReadingChunk,
  ReadingChunkType,
} from '../reading/reading.types.js';
import type { RefinerPatch, RefinementResult } from './ai-refiner.types.js';

const VALID_CHUNK_TYPES = new Set<ReadingChunkType>([
  'para',
  'heading',
  'verse',
  'toc',
  'quote',
  'list',
  'dedication',
  'meta',
  'caption',
  'code',
]);

const VALID_ALIGNS = new Set(['left', 'center', 'right']);

/** Never allow AI `drop` patches to delete long narrative prose (> 200 chars). */
const MAX_DROPPABLE_TEXT_LENGTH = 200;

/** Never allow AI `drop` patches to remove more than 25% of a book's chunks. */
const MAX_DROP_RATIO = 0.25;

/**
 * Parses and validates the LLM JSON patch list. Invalid entries are skipped
 * individually; malformed payloads return an empty array (fail-open).
 */
export function parseRefinerPatches(payload: unknown): RefinerPatch[] {
  const content = extractMessageContent(payload);
  if (!content) return [];

  const obj = parseJsonObject(content);
  if (!obj || !Array.isArray(obj.patches)) return [];

  const patches: RefinerPatch[] = [];
  for (const item of obj.patches) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const op = rec.op;
    const id = typeof rec.id === 'string' ? rec.id.trim() : '';
    if (!id) continue;

    if (op === 'merge') {
      patches.push({ op: 'merge', id });
    } else if (op === 'drop') {
      patches.push({ op: 'drop', id });
    } else if (op === 'reclassify') {
      const type = rec.type;
      if (typeof type !== 'string' || !VALID_CHUNK_TYPES.has(type as ReadingChunkType)) {
        continue;
      }
      const patch: RefinerPatch = {
        op: 'reclassify',
        id,
        type: type as ReadingChunkType,
      };
      if (rec.level === 1 || rec.level === 2 || rec.level === 3) {
        patch.level = rec.level;
      }
      if (typeof rec.align === 'string' && VALID_ALIGNS.has(rec.align)) {
        patch.align = rec.align as 'left' | 'center' | 'right';
      }
      patches.push(patch);
    }
  }

  return patches;
}

/**
 * Applies validated structural patches immutably over `document`. Author prose
 * is never rewritten; `merge` only joins consecutive chunks with a space, and
 * `drop` is bounded by `MAX_DROPPABLE_TEXT_LENGTH` and `MAX_DROP_RATIO`.
 */
export function applyRefinementPatches(
  document: BookReadingDocument,
  patches: RefinerPatch[],
  model?: string,
): RefinementResult {
  if (patches.length === 0 || document.chunks.length === 0) {
    return {
      document,
      summary: { applied: false, model, reclassified: 0, merged: 0, dropped: 0 },
    };
  }

  const reclassifyById = new Map<string, Extract<RefinerPatch, { op: 'reclassify' }>>();
  const mergeIds = new Set<string>();
  const dropIds = new Set<string>();

  for (const patch of patches) {
    if (patch.op === 'reclassify') reclassifyById.set(patch.id, patch);
    else if (patch.op === 'merge') mergeIds.add(patch.id);
    else if (patch.op === 'drop') dropIds.add(patch.id);
  }

  let reclassified = 0;
  let merged = 0;
  let dropped = 0;
  const maxDrops = Math.max(1, Math.floor(document.chunks.length * MAX_DROP_RATIO));

  const nextChunks: ReadingChunk[] = [];
  const src = document.chunks;

  for (let i = 0; i < src.length; i += 1) {
    const current = src[i];

    if (
      dropIds.has(current.id) &&
      current.text.length <= MAX_DROPPABLE_TEXT_LENGTH &&
      dropped < maxDrops
    ) {
      dropped += 1;
      continue;
    }

    let working: ReadingChunk = { ...current };
    const reclass = reclassifyById.get(working.id);
    if (reclass) {
      const changed =
        working.type !== reclass.type ||
        (reclass.level !== undefined && working.level !== reclass.level) ||
        (reclass.align !== undefined && working.align !== reclass.align);
      if (changed) {
        working.type = reclass.type;
        if (reclass.type === 'heading') {
          working.level = reclass.level ?? working.level ?? 2;
        } else {
          delete working.level;
        }
        if (reclass.align) {
          working.align = reclass.align;
        }
        reclassified += 1;
      }
    }

    if (mergeIds.has(working.id) && i + 1 < src.length) {
      const follower = src[i + 1];
      if (!dropIds.has(follower.id)) {
        working = mergeTwoChunks(working, follower);
        merged += 1;
        i += 1;
      }
    }

    nextChunks.push(working);
  }

  const applied = reclassified + merged + dropped > 0;
  const summary = { applied, model, reclassified, merged, dropped };
  if (!applied) {
    return { document, summary };
  }

  return {
    document: {
      ...document,
      refinedByAi: true,
      aiRefinement: summary,
      chunks: nextChunks,
    },
    summary,
  };
}

function mergeTwoChunks(first: ReadingChunk, second: ReadingChunk): ReadingChunk {
  const joinedText = `${first.text.trimEnd()} ${second.text.trimStart()}`.trim();
  const mergedRuns =
    first.runs && second.runs
      ? [...first.runs, { text: ' ' }, ...second.runs]
      : undefined;
  return {
    ...first,
    text: joinedText,
    ...(mergedRuns ? { runs: mergedRuns } : {}),
  };
}

function extractMessageContent(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = (choices[0] as { message?: { content?: unknown } } | null)?.message?.content;
  return typeof content === 'string' && content.trim().length > 0 ? content : null;
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const unfenced = content.replace(/```(?:json)?/gi, '').trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  try {
    const parsed: unknown = JSON.parse(unfenced.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
