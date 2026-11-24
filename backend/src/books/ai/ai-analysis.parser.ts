import type { AiAnalysis, AiSafety } from './ai-analysis.types.js';

const NOTES_LIMIT = 500;

/**
 * Validates one model answer. Anything that does not look like the requested
 * verdict — a refusal, prose, a truncated document, an unexpected safety label
 * or a missing quality — answers `null`, which the caller records as
 * `aiStatus: 'skipped'`: the analysis is optional and never blocks an upload.
 */
export function parseAiVerdict(payload: unknown): AiAnalysis | null {
  const content = messageContent(payload);
  if (content === null) {
    return null;
  }

  const parsed = parseJsonObject(content);
  if (!parsed) {
    return null;
  }

  const safety = normalizeSafety(parsed.safety);
  if (safety === null) {
    return null;
  }

  const quality = normalizeQuality(parsed.quality);
  if (quality === null) {
    return null;
  }

  return { safety, quality, notes: normalizeNotes(parsed.notes) };
}

/** `choices[0].message.content` of an OpenAI-compatible response, when present. */
function messageContent(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const message = (choices[0] as { message?: { content?: unknown } } | null)?.message;
  const content = message?.content;
  return typeof content === 'string' && content.trim().length > 0 ? content : null;
}

/**
 * Tolerant JSON extraction: models like to wrap the object in a markdown fence
 * or put a sentence in front of it, so the first `{` through the last `}` is
 * what gets parsed.
 */
function parseJsonObject(content: string): Record<string, unknown> | null {
  const unfenced = content.replace(/```(?:json)?/gi, '').trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(unfenced.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeSafety(value: unknown): AiSafety | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'ok' || normalized === 'suspect' ? normalized : null;
}

/** Accepts `4`, `"4"` and `4.6`, rounding and clamping onto 1..5. */
function normalizeQuality(value: unknown): number | null {
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.min(5, Math.max(1, Math.round(numeric)));
}

function normalizeNotes(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, NOTES_LIMIT) : '';
}
