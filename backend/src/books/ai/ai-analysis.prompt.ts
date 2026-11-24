import { truncateForAnalysis } from './ai-analysis.config.js';
import {
  buildEditorialSystemPrompt,
  EDITORIAL_STYLE_REFERENCE,
} from './editorial-reference.js';

/**
 * Editorial & layout-readability prompt for the text stage: PDF security is
 * handled deterministically by `pdf-firewall`, so the LLM focuses strictly on
 * editorial quality, structural clarity and reading-experience readiness.
 * Keeps the `{ safety, quality, notes }` JSON contract consumed by the `books`
 * table and `/admin` queue.
 *
 * The prompt is built verbatim from `EDITORIAL_STYLE_REFERENCE` (S5), the
 * single source /admin also serves through `GET /admin/ai/style-reference`.
 */
export const EDITORIAL_SYSTEM_PROMPT = buildEditorialSystemPrompt();

/** Backwards-compatible alias for the system prompt. */
export const MODERATION_SYSTEM_PROMPT = EDITORIAL_SYSTEM_PROMPT;

export { EDITORIAL_STYLE_REFERENCE };

export type ChatMessage = { role: 'system' | 'user'; content: string };

/** The two messages of one analysis call. */
export function moderationMessages(text: string): ChatMessage[] {
  return [
    { role: 'system', content: EDITORIAL_SYSTEM_PROMPT },
    { role: 'user', content: truncateForAnalysis(text) },
  ];
}
