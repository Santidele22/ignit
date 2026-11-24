/**
 * Single source of the editorial style reference (S5): the exact design and
 * quality lens the analysis LLM applies when judging an uploaded book. The
 * analysis prompt (`buildEditorialSystemPrompt`) and the admin endpoint
 * `GET /admin/ai/style-reference` are both derived from this object, so the
 * /admin panel always shows the reference the model actually runs with.
 */
export type EditorialQualityLevel = {
  score: 1 | 2 | 3 | 4 | 5;
  description: string;
};

export type EditorialStyleReference = {
  role: string;
  securityBoundary: string;
  qualityLabel: string;
  qualityRubric: EditorialQualityLevel[];
  safetyRule: string;
  outputShape: string;
  inputs: {
    readingText: string;
    maxCharacters: number;
  };
  neverJudges: string[];
};

export const EDITORIAL_STYLE_REFERENCE: EditorialStyleReference = {
  role: 'Sos el editor y diseñador editorial de una biblioteca digital en español (Ignit).',
  securityBoundary:
    'La seguridad del archivo ya fue validada por el firewall; tu foco es evaluar la calidad editorial, estructura y legibilidad del texto extraído para presentarlo en el lector.',
  qualityLabel: 'entero de 1 a 5 según estructura y diseño editorial del texto',
  qualityRubric: [
    { score: 1, description: 'texto roto, basura de OCR, caracteres corruptos o fragmentos ilegibles.' },
    {
      score: 2,
      description:
        'estructura muy pobre (párrafos cortados, encabezados/pies repetidos mezclados, tablas desarmadas).',
    },
    { score: 3, description: 'legible pero con ruido de maquetación o saltos de línea incómodos.' },
    {
      score: 4,
      description: 'buena estructura (títulos, capítulos y párrafos claros) con detalles menores.',
    },
    {
      score: 5,
      description: 'excelente calidad editorial, jerarquía clara y redacción limpia lista para lectura.',
    },
  ],
  safetyRule:
    '"suspect" SOLO si el texto es spam, relleno repetitivo, placeholder sin contenido real o basura de OCR completamente ilegible; "ok" para cualquier libro o documento legible.',
  outputShape:
    '{"safety":"ok"|"suspect","quality":1|2|3|4|5,"notes":"diagnóstico breve en español sobre estructura, legibilidad o maquetación"}',
  inputs: {
    readingText: 'el texto extraído del PDF (reading.json), sin el archivo original',
    maxCharacters: 24_000,
  },
  neverJudges: [
    'la seguridad del archivo (firewall determinista por tiers)',
    'el PDF original: el modelo solo ve texto extraído',
    'la decisión de publicación del admin',
  ],
};

/** Builds the analysis system prompt verbatim from the reference. */
export function buildEditorialSystemPrompt(
  reference: EditorialStyleReference = EDITORIAL_STYLE_REFERENCE,
): string {
  return [
    reference.role,
    reference.securityBoundary,
    'Evaluá dos cosas:',
    `1. quality: ${reference.qualityLabel}:`,
    ...reference.qualityRubric.map((level) => `   - ${level.score}: ${level.description}`),
    `2. safety: ${reference.safetyRule}`,
    'Respondé SOLO con un objeto JSON válido, sin markdown ni comentarios, con esta forma exacta:',
    reference.outputShape,
  ].join('\n');
}
