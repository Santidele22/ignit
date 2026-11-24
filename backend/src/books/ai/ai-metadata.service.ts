import { chatCompletionsUrl, llmEndpoint } from './ai-analysis.config.js';
import type { AiAnalysisOptions } from './ai-analysis.service.js';

export type SuggestedBookMetadata = {
  title: string | null;
  author: string | null;
  description: string | null;
};

const SUGGEST_TIMEOUT_MS = 6_000;

const METADATA_SYSTEM_PROMPT = [
  'Sos un asistente bibliográfico rápido para una biblioteca digital en español (Ignit).',
  'Dado el nombre de archivo de un PDF, inferí los metadatos del libro si lo reconocés o limpiá el título/autor del nombre.',
  'Respondé SOLO con JSON válido, sin markdown ni comentarios:',
  '{"title":"título limpio o vacío","author":"nombre completo del autor o vacío","description":"sinopsis breve de 1 o 2 oraciones en español sobre la obra o vacío"}',
].join('\n');

/**
 * Fast fail-open LLM prefill for the upload form (`title`, `author`, `description`)
 * from the selected PDF filename before the file itself is uploaded.
 */
export async function suggestMetadataFromFilename(
  rawFilename: string,
  options: AiAnalysisOptions = {},
): Promise<SuggestedBookMetadata> {
  const empty: SuggestedBookMetadata = { title: null, author: null, description: null };
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

export function parseSuggestedMetadata(payload: unknown): SuggestedBookMetadata {
  const empty: SuggestedBookMetadata = { title: null, author: null, description: null };
  if (typeof payload !== 'object' || payload === null) return empty;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return empty;
  const content = (choices[0] as { message?: { content?: unknown } } | null)?.message?.content;
  if (typeof content !== 'string') return empty;

  const unfenced = content.replace(/```(?:json)?/gi, '').trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) return empty;

  try {
    const parsed = JSON.parse(unfenced.slice(start, end + 1)) as Record<string, unknown>;
    const clean = (val: unknown, max: number) =>
      typeof val === 'string' && val.trim().length > 0 ? val.trim().slice(0, max) : null;
    return {
      title: clean(parsed.title, 180),
      author: clean(parsed.author, 140),
      description: clean(parsed.description, 400),
    };
  } catch {
    return empty;
  }
}
