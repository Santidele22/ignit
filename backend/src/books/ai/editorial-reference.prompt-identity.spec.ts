import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EDITORIAL_SYSTEM_PROMPT } from './ai-analysis.prompt.js';
import { buildEditorialSystemPrompt } from './editorial-reference.js';

/** EDITORIAL_SYSTEM_PROMPT verbatim from commit 4c690a1 (pre-single-source). */
const BASELINE_PROMPT = [
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

describe('editorial prompt identity (S5)', () => {
  it('rebuilds the shipped prompt byte-for-byte', () => {
    expect(buildEditorialSystemPrompt()).toBe(BASELINE_PROMPT);
    expect(EDITORIAL_SYSTEM_PROMPT).toBe(BASELINE_PROMPT);
    expect(createHash('sha256').update(BASELINE_PROMPT).digest('hex')).toBe(
      'f80a5bbef57c725496f51be8eed492326984ef3426419b759545dbfac96e76e2',
    );
  });
});
