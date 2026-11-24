import { truncateForAnalysis } from './ai-analysis.config.js';

/**
 * Moderation prompt for the text-only stage (S3): the model only sees the
 * extracted reading text, never the layout, so it is asked for two separable
 * judgements — safety and editorial quality — and for strict JSON only, which
 * the parser then validates defensively.
 */
export const MODERATION_SYSTEM_PROMPT = [
  'Sos el moderador de una biblioteca digital en español.',
  'Vas a leer el texto extraído de un PDF que un usuario quiere subir.',
  'Evaluá dos cosas:',
  '1. safety: "suspect" si el texto contiene incitación al odio, violencia explícita, contenido sexual con menores, instrucciones para dañar a personas, malware o estafas; "ok" en cualquier otro caso.',
  '2. quality: entero de 1 (ilegible o vacío) a 5 (texto digitalizado con claridad y estructura).',
  'Respondé SOLO con un objeto JSON válido, sin markdown ni comentarios, con esta forma exacta:',
  '{"safety":"ok"|"suspect","quality":1|2|3|4|5,"notes":"motivo breve en español"}',
].join('\n');

export type ChatMessage = { role: 'system' | 'user'; content: string };

/** The two messages of one analysis call. */
export function moderationMessages(text: string): ChatMessage[] {
  return [
    { role: 'system', content: MODERATION_SYSTEM_PROMPT },
    { role: 'user', content: truncateForAnalysis(text) },
  ];
}
