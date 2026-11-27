import type { BookReadingDocument } from '../reading/reading.types.js';
import {
  chatCompletionsUrl,
  llmEndpoint,
  type LlmEndpoint,
} from './ai-analysis.config.js';
import type { AiAnalysisOptions } from './ai-analysis.service.js';
import type { ChatMessage } from './ai-analysis.prompt.js';

export type BookBlueprintGenre = 'fiction' | 'essay' | 'technical' | 'poetry';

export interface BookBlueprint {
  genre: BookBlueprintGenre;
  bodyStartChunkId: string | null;
  headingConvention: string | null;
  qualityAlerts: string[];
}

const VALID_GENRES = new Set<BookBlueprintGenre>(['fiction', 'essay', 'technical', 'poetry']);
const BLUEPRINT_TIMEOUT_MS = 15_000;

const BLUEPRINT_SYSTEM_PROMPT = [
  'Sos el editor jefe de Ignit. Analizá el inicio y los títulos de un libro extraído para generar un Blueprint global en JSON.',
  'Devolvé SOLO JSON válido con exactamente estas claves:',
  '{"genre":"fiction|essay|technical|poetry","bodyStartChunkId":"id o null","headingConvention":"patrón breve o null","qualityAlerts":["alerta breve si hay versalitas truncadas o glifos rotos"]}',
].join('\n');

export function buildBlueprintMessages(
  document: BookReadingDocument,
  bookMeta?: { title?: string; author?: string } | null,
): ChatMessage[] {
  const sample: string[] = [];
  if (bookMeta?.title || bookMeta?.author) {
    sample.push(`Libro: ${bookMeta?.title ?? 'Sin título'} — ${bookMeta?.author ?? 'Autor desconocido'}`);
  }
  const front = document.chunks.slice(0, 35);
  const laterHeadings = document.chunks
    .slice(35)
    .filter((c) => c.type === 'heading' || c.type === 'toc')
    .slice(0, 15);
  for (const c of [...front, ...laterHeadings]) {
    const clean = c.text.replace(/\s+/g, ' ').trim().slice(0, 140);
    sample.push(`[${c.id}|${c.type}|p${c.page}] ${clean}`);
  }
  return [
    { role: 'system', content: BLUEPRINT_SYSTEM_PROMPT },
    { role: 'user', content: sample.join('\n') },
  ];
}

export function parseBookBlueprint(payload: unknown): BookBlueprint | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = (choices[0] as { message?: { content?: unknown } })?.message?.content;
  if (typeof content !== 'string' || !content.trim()) return null;

  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const rec = parsed as Record<string, unknown>;
  const genre =
    typeof rec.genre === 'string' && VALID_GENRES.has(rec.genre as BookBlueprintGenre)
      ? (rec.genre as BookBlueprintGenre)
      : 'essay';
  const bodyStartChunkId =
    typeof rec.bodyStartChunkId === 'string' && rec.bodyStartChunkId.trim()
      ? rec.bodyStartChunkId.trim()
      : null;
  const headingConvention =
    typeof rec.headingConvention === 'string' && rec.headingConvention.trim()
      ? rec.headingConvention.trim().slice(0, 120)
      : null;
  const qualityAlerts = Array.isArray(rec.qualityAlerts)
    ? rec.qualityAlerts
        .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
        .map((a) => a.trim().slice(0, 160))
        .slice(0, 5)
    : [];

  return { genre, bodyStartChunkId, headingConvention, qualityAlerts };
}

/** Generates a single-call global Book Blueprint for the refiner (fail-open). */
export async function generateBookBlueprint(
  document: BookReadingDocument,
  options: AiAnalysisOptions & { bookMeta?: { title?: string; author?: string } | null } = {},
): Promise<BookBlueprint | null> {
  const endpoint: LlmEndpoint | null = llmEndpoint(options.env ?? process.env);
  if (!endpoint || document.chunks.length === 0) return null;

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return null;

  try {
    const response = await fetchImpl(chatCompletionsUrl(endpoint.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify({
        model: endpoint.model,
        messages: buildBlueprintMessages(document, options.bookMeta),
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? BLUEPRINT_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseBookBlueprint(await response.json());
  } catch {
    return null;
  }
}
