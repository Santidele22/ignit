import { truncateForAnalysis } from './ai-analysis.config.js';

/**
 * Editorial & layout-readability prompt for the text stage: PDF security is
 * handled deterministically by `pdf-firewall`, so the LLM focuses strictly on
 * editorial quality, structural clarity and reading-experience readiness.
 */
export const EDITORIAL_SYSTEM_PROMPT = [
  'Sos el editor y diseñador editorial de una biblioteca digital en español (Ignit).',
  'La seguridad del archivo ya fue validada por el firewall; tu foco es evaluar la calidad editorial, estructura y legibilidad del texto extraído para presentarlo en el lector.',
  'Evaluá dos cosas:',
  '1. quality: entero de 1 a 5 según estructura y diseño editorial del texto:',
  '   - 1: texto roto, basura de OCR, caracteres corruptos o fragmentos ilegibles.',
  '   - 2: estructura muy pobre (párrafos cortados, encabezados/pies repetidos mezclados, tablas desarmadas).',
  '   - 3: legible pero con ruido de maquetación o saltos de línea incómodos.',
  '   - 4: buena estructura (títulos, capítulos y párrafos claros) con detalles menores.',
  '   - 5: excelente calidad editorial, jerarquía clara y redacción limpia lista para lectura.',
  '2. safety: "suspect" SOLO si el texto es spam, relleno repetitivo, placeholder sin contenido real o basura de OCR completamente ilegible; "ok" para cualquier libro o documento legible.',
  'Respondé SOLO con un objeto JSON válido, sin markdown ni comentarios, con esta forma exacta:',
  '{"safety":"ok"|"suspect","quality":1|2|3|4|5,"notes":"diagnóstico breve en español sobre estructura, legibilidad o maquetación"}',
].join('\n');

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
