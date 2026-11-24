/** Model used when `LLM_MODEL` is unset (gentle-nan proxy default). */
export const DEFAULT_LLM_MODEL = 'deepseek-chat';

/** Characters of reading text sent to the model; the tail is dropped. */
export const AI_TEXT_LIMIT = 24_000;

/** Hard cap on one analysis call, so an upload never waits longer than this. */
export const AI_REQUEST_TIMEOUT_MS = 10_000;

/** Resolved endpoint of the OpenAI-compatible API the stage talks to. */
export type LlmEndpoint = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

/**
 * Reads the S3 env gate: the stage only runs when **both** `LLM_BASE_URL` and
 * `LLM_API_KEY` are configured. Read on every call (not at import time) so a
 * deployment can enable or disable the stage without a code change, and a
 * partially configured environment silently disables it instead of failing.
 */
export function llmEndpoint(env: NodeJS.ProcessEnv = process.env): LlmEndpoint | null {
  const baseUrl = env.LLM_BASE_URL?.trim();
  const apiKey = env.LLM_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    return null;
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    model: env.LLM_MODEL?.trim() || DEFAULT_LLM_MODEL,
  };
}

/** OpenAI-compatible chat completions URL for the configured base. */
export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

/** Truncates the reading text to `AI_TEXT_LIMIT` characters. */
export function truncateForAnalysis(text: string, limit: number = AI_TEXT_LIMIT): string {
  return text.length > limit ? text.slice(0, limit) : text;
}
