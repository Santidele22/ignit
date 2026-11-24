import type { BookReadingDocument, ReadingChunk } from '../reading/reading.types.js';
import type { ChatMessage } from './ai-analysis.prompt.js';

const FRONT_MATTER_LIMIT = 40;
const CHUNK_PREVIEW_LIMIT = 240;
const REFINER_CHAR_BUDGET = 18_000;

const SENTENCE_END_RE = /[.!?…"»)\]]\s*$/;

export const REFINER_SYSTEM_PROMPT = [
  'Sos el diagramador editorial de Ignit (lector Vigilia).',
  'Recibís chunks extraídos de un PDF por un algoritmo determinista. Todos los libros comparten la estética de Vigilia, pero a veces el algoritmo clasifica mal el índice (toc), títulos (heading + level 1|2|3), dedicatorias (dedication), citas (quote), código (code), epígrafes (caption), deja párrafos cortados entre páginas o cuela encabezados repetidos.',
  'Reglas estrictas:',
  '- NUNCA reescribas ni inventes texto: solo emití parches por `id`.',
  '- `reclassify`: cambiá `type` (`para` | `heading` | `toc` | `quote` | `dedication` | `list` | `code` | `caption` | `verse` | `meta`), opcionalmente `level` (1|2|3 para `heading`) y `align` (`left`|`center`|`right`).',
  '- `merge`: uní el chunk `id` con el siguiente si el primero quedó cortado a mitad de oración por salto de página.',
  '- `drop`: descartá un chunk SOLO si es ruido repetido de encabezado/pie de página o número de página suelto.',
  '- Si un chunk ya está bien clasificado, NO emitas parche para ese `id`.',
  'Respondé SOLO con JSON válido, sin markdown ni comentarios:',
  '{"patches":[{"op":"reclassify","id":"...","type":"heading","level":1},{"op":"merge","id":"..."},{"op":"drop","id":"..."}]}',
].join('\n');

/**
 * Selects structurally interesting chunks (front matter + short/ambiguous
 * blocks + page-boundary splits) up to `REFINER_CHAR_BUDGET` characters so the
 * LLM does not waste tokens on long clean narrative paragraphs.
 */
export function selectRefinerCandidates(document: BookReadingDocument): ReadingChunk[] {
  const chunks = document.chunks;
  if (chunks.length === 0) {
    return [];
  }

  const selected: ReadingChunk[] = [];
  const seen = new Set<string>();
  let totalChars = 0;

  const tryPush = (chunk: ReadingChunk): boolean => {
    if (seen.has(chunk.id)) return true;
    const lineLen = formatChunkLine(chunk).length + 1;
    if (totalChars + lineLen > REFINER_CHAR_BUDGET) {
      return false;
    }
    seen.add(chunk.id);
    selected.push(chunk);
    totalChars += lineLen;
    return true;
  };

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const next = chunks[i + 1];
    const isFrontMatter = i < FRONT_MATTER_LIMIT;
    const isAmbiguousShort = chunk.text.length <= 160;
    const isSpecialType = chunk.type !== 'para';
    const isBrokenPageSplit =
      Boolean(next) &&
      chunk.page !== next.page &&
      chunk.type === 'para' &&
      !SENTENCE_END_RE.test(chunk.text);

    if (isFrontMatter || isAmbiguousShort || isSpecialType || isBrokenPageSplit) {
      if (!tryPush(chunk)) break;
      if (isBrokenPageSplit && next) {
        if (!tryPush(next)) break;
      }
    }
  }

  return selected;
}

export function formatChunkLine(chunk: ReadingChunk): string {
  const clean = chunk.text.replace(/\s+/g, ' ').trim();
  const preview =
    clean.length > CHUNK_PREVIEW_LIMIT
      ? `${clean.slice(0, CHUNK_PREVIEW_LIMIT)}…`
      : clean;
  const levelTag = chunk.level ? `:L${chunk.level}` : '';
  return `[${chunk.id}|${chunk.type}${levelTag}|p${chunk.page}] ${preview}`;
}

export function refinerMessages(candidates: ReadingChunk[]): ChatMessage[] {
  const userContent = candidates.map(formatChunkLine).join('\n');
  return [
    { role: 'system', content: REFINER_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
