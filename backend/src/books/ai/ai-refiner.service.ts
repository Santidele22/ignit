import type { BookReadingDocument } from '../reading/reading.types.js';
import {
  chatCompletionsUrl,
  llmEndpoint,
} from './ai-analysis.config.js';
import type { AiAnalysisOptions } from './ai-analysis.service.js';
import { applyRefinementPatches, parseRefinerPatches } from './ai-refiner.parser.js';
import { refinerMessages, selectRefinerCandidateBatches } from './ai-refiner.prompt.js';
import type { RefinerPatch, RefinementResult } from './ai-refiner.types.js';

/** Refiner calls output structured patch lists and need more headroom than 10s. */
const REFINER_TIMEOUT_MS = 25_000;

/**
 * Optional LLM structural refiner for `reading.json`: keeps Ignit's unified
 * Vigilia aesthetic and the deterministic extraction as the base, and processes
 * up to 5 batches of candidate chunks (`toc`, headings, cross-page splits,
 * converter/OCR clutter) fail-open.
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

  const batches = selectRefinerCandidateBatches(document);
  if (batches.length === 0) {
    return skipped;
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return skipped;
  }

  const allPatches: RefinerPatch[] = [];
  for (const batch of batches) {
    try {
      const response = await fetchImpl(chatCompletionsUrl(endpoint.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${endpoint.apiKey}`,
        },
        body: JSON.stringify({
          model: endpoint.model,
          messages: refinerMessages(batch),
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? REFINER_TIMEOUT_MS),
      });

      if (!response.ok) {
        continue;
      }

      allPatches.push(...parseRefinerPatches(await response.json()));
    } catch {
      continue;
    }
  }

  if (allPatches.length === 0) {
    return skipped;
  }

  return applyRefinementPatches(document, allPatches, endpoint.model);
}
