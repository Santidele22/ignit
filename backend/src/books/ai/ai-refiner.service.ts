import type { AiClutterItem, BookReadingDocument } from '../reading/reading.types.js';
import {
  chatCompletionsUrl,
  llmEndpoint,
  type LlmEndpoint,
} from './ai-analysis.config.js';
import type { AiAnalysisOptions } from './ai-analysis.service.js';
import { applyRefinementPatches, parseRefinerPatches } from './ai-refiner.parser.js';
import { refinerMessages, selectRefinerCandidateBatches } from './ai-refiner.prompt.js';
import type { RefinerPatch, RefinementResult } from './ai-refiner.types.js';

import { generateBookBlueprint, type BookBlueprint } from './ai-blueprint.js';

/** Refiner calls output structured patch lists and need more headroom than 10s. */
const REFINER_TIMEOUT_MS = 25_000;
const DEFAULT_DESIGN_PASSES = 2;

export type RefineReadingOptions = AiAnalysisOptions & {
  passes?: number;
  bookMeta?: { title?: string; author?: string } | null;
};

async function runSingleRefinerPass(
  document: BookReadingDocument,
  endpoint: LlmEndpoint,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  pass: 1 | 2,
  blueprint: BookBlueprint | null,
): Promise<RefinementResult & { batchesTotal: number; batchesSucceeded: number; batchesFailed: number }> {
  const skipped = {
    document,
    summary: { applied: false, reclassified: 0, merged: 0, dropped: 0 },
    batchesTotal: 0,
    batchesSucceeded: 0,
    batchesFailed: 0,
  };

  const batches = selectRefinerCandidateBatches(document);
  if (batches.length === 0) {
    return skipped;
  }

  let batchesSucceeded = 0;
  let batchesFailed = 0;

  const batchResults = await Promise.all(
    batches.map(async (batch): Promise<RefinerPatch[]> => {
      try {
        const messages = refinerMessages(batch, pass);
        if (blueprint && messages[0]) {
          messages[0] = {
            ...messages[0],
            content: `${messages[0].content}\nBlueprint global: genre=${blueprint.genre}, bodyStart=${blueprint.bodyStartChunkId ?? 'unknown'}, headings=${blueprint.headingConvention ?? 'auto'}.`,
          };
        }
        const response = await fetchImpl(chatCompletionsUrl(endpoint.baseUrl), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${endpoint.apiKey}`,
          },
          body: JSON.stringify({
            model: endpoint.model,
            messages,
            response_format: { type: 'json_object' },
            temperature: 0.1,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!response.ok) {
          batchesFailed += 1;
          return [];
        }

        batchesSucceeded += 1;
        return parseRefinerPatches(await response.json());
      } catch {
        batchesFailed += 1;
        return [];
      }
    }),
  );

  const allPatches = batchResults.flat();
  if (allPatches.length === 0) {
    return { ...skipped, batchesTotal: batches.length, batchesSucceeded, batchesFailed };
  }

  return {
    ...applyRefinementPatches(document, allPatches, endpoint.model),
    batchesTotal: batches.length,
    batchesSucceeded,
    batchesFailed,
  };
}

/**
 * Automatic two-pass LLM structural refiner for `reading.json`: keeps Ignit's
 * unified Vigilia aesthetic and the deterministic extraction as the base, and
 * reviews the document twice (`passes = 2` by default) so newly exposed
 * page-boundary splits, headings, and residual clutter/unicode are caught
 * automatically before persistence.
 */
export async function refineReadingDocument(
  document: BookReadingDocument,
  options: RefineReadingOptions = {},
): Promise<RefinementResult> {
  const skipped: RefinementResult = {
    document,
    summary: { applied: false, reclassified: 0, merged: 0, dropped: 0 },
  };

  const endpoint = llmEndpoint(options.env ?? process.env);
  if (!endpoint || document.chunks.length === 0) {
    return skipped;
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return skipped;
  }

  const totalPasses = Math.max(1, options.passes ?? DEFAULT_DESIGN_PASSES);
  const timeoutMs = options.timeoutMs ?? REFINER_TIMEOUT_MS;
  const blueprint =
    document.chunks.length >= 15
      ? await generateBookBlueprint(document, {
          env: options.env,
          fetchImpl,
          timeoutMs,
          bookMeta: options.bookMeta,
        })
      : null;

  let currentDoc = document;
  let reclassified = 0;
  let merged = 0;
  let dropped = 0;
  let applied = false;
  const clutter: AiClutterItem[] = [];
  const corruptFlags: { id: string; page: number; reason: string }[] = [];
  let passesExecuted = 0;

  for (let pass = 0; pass < totalPasses; pass += 1) {
    if (currentDoc.chunks.length === 0) break;
    const passNumber: 1 | 2 = pass === 0 ? 1 : 2;
    const result = await runSingleRefinerPass(currentDoc, endpoint, fetchImpl, timeoutMs, passNumber, blueprint);
    passesExecuted += 1;
    currentDoc = result.document;
    if (result.summary.applied) {
      applied = true;
      reclassified += result.summary.reclassified;
      merged += result.summary.merged;
      dropped += result.summary.dropped;
    }
    if (result.summary.clutter?.length) {
      clutter.push(...result.summary.clutter);
    }
    if (result.summary.corruptFlags?.length) {
      corruptFlags.push(...result.summary.corruptFlags);
    }
    if (!result.summary.applied && !result.summary.corruptFlags?.length) {
      break;
    }
  }

  if (!applied && clutter.length === 0 && corruptFlags.length === 0) {
    return skipped;
  }

  return {
    document: currentDoc,
    summary: {
      applied,
      model: endpoint.model,
      passes: passesExecuted,
      reclassified,
      merged,
      dropped,
      ...(clutter.length > 0 ? { clutter } : {}),
      ...(corruptFlags.length > 0 ? { corruptFlags } : {}),
    },
  };
}
