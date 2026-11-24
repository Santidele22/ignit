import { truncateForAnalysis } from './ai-analysis.config.js';
import { buildEditorialSystemPrompt } from './editorial-reference.js';

/**
 * Editorial & book-authenticity prompt derived from `EDITORIAL_STYLE_REFERENCE`
 * so `/admin` and the LLM always share the exact same single source of truth.
 */
export const EDITORIAL_SYSTEM_PROMPT = buildEditorialSystemPrompt();

/** Backwards-compatible alias for the system prompt. */
export const MODERATION_SYSTEM_PROMPT = EDITORIAL_SYSTEM_PROMPT;

export type ChatMessage = { role: 'system' | 'user'; content: string };

/** The two messages of one analysis call. */
export function moderationMessages(text: string): ChatMessage[] {
  return [
    { role: 'system', content: EDITORIAL_SYSTEM_PROMPT },
    { role: 'user', content: truncateForAnalysis(text) },
  ];
}
