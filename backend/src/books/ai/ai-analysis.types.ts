/** What the moderation stage concluded about the text of a book. */
export type AiSafety = 'ok' | 'suspect';

/**
 * Outcome persisted on the book row: `ok`/`suspect` mirror the verdict, and
 * `skipped` records that no analysis ran (env gate off, empty text, or any
 * failure of the model call — the stage is fail-open by design).
 */
export type AiStatus = 'ok' | 'suspect' | 'skipped';

/** Parsed, validated model verdict. */
export type AiAnalysis = {
  safety: AiSafety;
  quality: number;
  notes: string;
};

/** The four `books` columns the analysis stage writes. */
export type AiVerdictColumns = {
  aiSafety: AiSafety | null;
  aiQuality: number | null;
  aiNotes: string | null;
  aiStatus: AiStatus;
};
