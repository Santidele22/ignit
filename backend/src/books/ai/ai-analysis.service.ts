import type { BookReadingDocument } from '../reading/book-reading.extractor.js';
import {
  AI_REQUEST_TIMEOUT_MS,
  chatCompletionsUrl,
  llmEndpoint,
} from './ai-analysis.config.js';
import { parseAiVerdict } from './ai-analysis.parser.js';
import { moderationMessages } from './ai-analysis.prompt.js';
import type { AiAnalysis, AiVerdictColumns } from './ai-analysis.types.js';

/** Injectable seams so the stage can be unit-tested without a real model. */
export type AiAnalysisOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Optional text-level analysis (S3): one OpenAI-compatible chat completion
 * over the extracted reading text, in front of the admin review queue.
 *
 * Fully fail-open — the endpoint is env-gated, the call is capped at 10 s, and
 * every failure (missing configuration, network error, timeout, refusal,
 * unparseable answer) resolves `null`. Callers persist that as
 * `aiStatus: 'skipped'`, so an unavailable model never blocks an upload or a
 * review.
 */
export async function analyzeBookText(
  text: string,
  options: AiAnalysisOptions = {},
): Promise<AiAnalysis | null> {
  const endpoint = llmEndpoint(options.env ?? process.env);
  if (!endpoint || text.trim().length === 0) {
    return null;
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return null;
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
        messages: moderationMessages(text),
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? AI_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    return parseAiVerdict(await response.json());
  } catch {
    return null;
  }
}

/** The reading text the stage analyses: every extracted chunk, in order. */
export function readingTextOf(document: BookReadingDocument): string {
  return document.chunks
    .map((chunk) => chunk.text.trim())
    .filter((text) => text.length > 0)
    .join('\n\n');
}

/** Analyses an extracted reading document; empty text skips the call. */
export function analyzeReadingDocument(
  document: BookReadingDocument,
  options: AiAnalysisOptions = {},
): Promise<AiAnalysis | null> {
  const text = readingTextOf(document);
  if (text.length === 0) {
    return Promise.resolve(null);
  }

  return analyzeBookText(text, options);
}

/** Maps the analysis outcome onto the four `books` columns it persists. */
export function aiColumnsFor(analysis: AiAnalysis | null): AiVerdictColumns {
  if (!analysis) {
    return { aiSafety: null, aiQuality: null, aiNotes: null, aiStatus: 'skipped' };
  }

  return {
    aiSafety: analysis.safety,
    aiQuality: analysis.quality,
    aiNotes: analysis.notes,
    aiStatus: analysis.safety === 'suspect' ? 'suspect' : 'ok',
  };
}
