import { chatCompletionsUrl, llmEndpoint } from './ai-analysis.config.js';
import type { AiAnalysisOptions } from './ai-analysis.service.js';

export type SuggestedBookMetadata = {
  title: string | null;
  author: string | null;
  description: string | null;
  coverQueries: string[];
};

const SUGGEST_TIMEOUT_MS = 6_000;
const COVER_QUERY_EXPAND_TIMEOUT_MS = 4_000;

const METADATA_SYSTEM_PROMPT = [
  'Sos un asistente bibliográfico rápido para una biblioteca digital en español (Ignit).',
  'Dado el nombre de archivo de un PDF, inferí los metadatos del libro si lo reconocés o limpiá el título/autor del nombre.',
  'Para `author`, usá el nombre con el que se publica habitualmente el autor (ej. "E. M. Forster", "J. R. R. Tolkien", "Jorge Luis Borges"), no nombres legales poco usados.',
  'Para `coverQueries`, devolvé 2 o 3 consultas cortas y efectivas para encontrar la portada en catálogos de libros (OpenLibrary, Apple Books, Google Books): primero título en español + autor habitual, y si la obra fue traducida incluí también el título original en su idioma original + autor (ej. ["La máquina se detiene E. M. Forster", "The Machine Stops E. M. Forster"]).',
  'Respondé SOLO con JSON válido, sin markdown ni comentarios:',
  '{"title":"título limpio o vacío","author":"nombre editorial habitual del autor o vacío","description":"sinopsis breve de 1 o 2 oraciones en español sobre la obra o vacío","coverQueries":["consulta 1","consulta 2"]}',
].join('\n');

const COVER_QUERY_EXPAND_PROMPT = [
  'Sos un asistente bibliográfico para buscar portadas de libros en OpenLibrary, Apple Books y Google Books.',
  'Dada una búsqueda de libro que no devolvió portadas, devolvé 2 o 3 consultas cortas alternativas de alto recall: título original en su idioma original + nombre editorial habitual del autor (ej. "The Machine Stops E. M. Forster") y variante corta título + apellido del autor.',
  'Respondé SOLO con JSON válido, sin markdown ni comentarios:',
  '{"queries":["consulta 1","consulta 2"]}',
].join('\n');

/**
 * Fast fail-open LLM prefill for the upload form (`title`, `author`, `description`, `coverQueries`)
 * from the selected PDF filename before the file itself is uploaded.
 */
export async function suggestMetadataFromFilename(
  rawFilename: string,
  options: AiAnalysisOptions = {},
): Promise<SuggestedBookMetadata> {
  const empty: SuggestedBookMetadata = {
    title: null,
    author: null,
    description: null,
    coverQueries: [],
  };
  const filename = rawFilename.trim();
  const endpoint = llmEndpoint(options.env ?? process.env);
  if (!endpoint || filename.length === 0) {
    return empty;
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return empty;
  }

  try {
    const response = await fetchImpl(chatCompletionsUrl(endpoint.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify({
        model: endpoint.model,
        messages: [
          { role: 'system', content: METADATA_SYSTEM_PROMPT },
          { role: 'user', content: `Archivo: ${filename.slice(0, 240)}` },
        ],
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? SUGGEST_TIMEOUT_MS),
    });

    if (!response.ok) return empty;
    return parseSuggestedMetadata(await response.json());
  } catch {
    return empty;
  }
}

/**
 * Fast fail-open LLM helper invoked only when direct catalog cover queries
 * return zero relevant covers (e.g., Spanish title + full legal author name).
 */
export async function suggestCoverSearchQueries(
  rawQuery: string,
  options: AiAnalysisOptions = {},
): Promise<string[]> {
  const query = rawQuery.trim();
  const endpoint = llmEndpoint(options.env ?? process.env);
  if (!endpoint || query.length === 0) {
    return [];
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return [];
  }

  try {
    const response = await fetchImpl(chatCompletionsUrl(endpoint.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify({
        model: endpoint.model,
        messages: [
          { role: 'system', content: COVER_QUERY_EXPAND_PROMPT },
          { role: 'user', content: `Búsqueda: ${query.slice(0, 200)}` },
        ],
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? COVER_QUERY_EXPAND_TIMEOUT_MS),
    });

    if (!response.ok) return [];
    const parsed = extractJsonObject(await response.json());
    return parseQueryList(parsed?.queries);
  } catch {
    return [];
  }
}

function extractJsonObject(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = (choices[0] as { message?: { content?: unknown } } | null)?.message?.content;
  if (typeof content !== 'string') return null;

  const unfenced = content.replace(/```(?:json)?/gi, '').trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(unfenced.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseQueryList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const cleaned = entry.trim().slice(0, 140);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= 3) break;
  }
  return out;
}

export function parseSuggestedMetadata(payload: unknown): SuggestedBookMetadata {
  const empty: SuggestedBookMetadata = {
    title: null,
    author: null,
    description: null,
    coverQueries: [],
  };
  const parsed = extractJsonObject(payload);
  if (!parsed) return empty;
  const clean = (val: unknown, max: number) =>
    typeof val === 'string' && val.trim().length > 0 ? val.trim().slice(0, max) : null;
  return {
    title: clean(parsed.title, 180),
    author: clean(parsed.author, 140),
    description: clean(parsed.description, 400),
    coverQueries: parseQueryList(parsed.coverQueries),
  };
}
