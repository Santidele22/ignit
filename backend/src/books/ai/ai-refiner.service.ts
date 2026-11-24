import type { BookReadingDocument } from '../reading/reading.types.js';
import {
  AI_REQUEST_TIMEOUT_MS,
  chatCompletionsUrl,
  llmEndpoint,
} from './ai-analysis.config.js';
import type { AiAnalysisOptions } from './ai-analysis.service.js';
import { applyRefinementPatches, parseRefinerPatches } from './ai-refiner.parser.js';
import { refinerMessages, selectRefinerCandidates } from './ai-refiner.prompt.js';
import type { RefinementResult } from './ai-refiner.types.js';

/**
 * Optional LLM structural refiner for `reading.json`: keeps Ignit's unified
 * Vigilia aesthetic and the deterministic extraction as the base, and asks the
 * configured OpenAI-compatible model for `chunk.id` patches to fix misclassified
 * `toc`, `heading` levels, broken cross-page paragraphs and residual noise.
 *
 * Strictly fail-open: missing env, empty candidates, network errors, timeouts
 * or invalid JSON return the original deterministic `document` untouched.
 */
export async function refineReadingDocument(
  document: BookReadingDocument,
  options: AiAnalysisOptions = {},
): Promise<RefinementResult> {
  const skipped: RefinementResult = {
    document,
    summary: { applied: false, reclassified: 0, merged: 0, dropped: 0 },
  };

  const endpoint = llmEndpoint(options.env ?? process.env);
  if (!endpoint || document.chunks.length === 0) {
    return skipped;
  }

  const candidates = selectRefinerCandidates(document);
  if (candidates.length === 0) {
    return skipped;
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return skipped;
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
        messages: refinerMessages(candidates),
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? AI_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return skipped;
    }

    const patches = parseRefinerPatches(await response.json());
    return applyRefinementPatches(document, patches, endpoint.model);
  } catch {
    return skipped;
  }
}
