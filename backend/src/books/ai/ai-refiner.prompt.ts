import type { BookReadingDocument, ReadingChunk } from '../reading/reading.types.js';
import type { ChatMessage } from './ai-analysis.prompt.js';

const FRONT_MATTER_LIMIT = 40;
const CHUNK_PREVIEW_LIMIT = 240;
const REFINER_CHAR_BUDGET = 10_000;

const SENTENCE_END_RE = /[.!?…"»)\]]\s*$/;

export const REFINER_SYSTEM_PROMPT = [
  'Sos el diagramador editorial de Ignit (lector Vigilia).',
  'Recibís chunks extraídos de un PDF por un algoritmo determinista. Todos los libros comparten la estética de Vigilia, pero a veces el algoritmo clasifica mal el índice (toc), títulos (heading + level 1|2|3), dedicatorias (dedication), citas (quote), código (code), epígrafes (caption), deja párrafos cortados entre páginas o cuela suciedad (artefactos de conversión, banners de descarga, encabezados repetidos, metadatos sueltos).',
  'Reglas estrictas:',
  '- NUNCA reescribas ni inventes texto: solo emití parches por `id`.',
  '- `reclassify`: cambiá `type` (`para` | `dialogue` | `heading` | `toc` | `quote` | `dedication` | `list` | `code` | `caption` | `verse` | `meta`), opcionalmente `level` (1|2|3 para `heading`) y `align` (`left`|`center`|`right`). Usá `dialogue` para parlamentos o conversaciones habladas (rayas `—` o comillas literarias con verbo de habla; nunca los dejes como `code` o `meta`). Usá `meta` para créditos editoriales, autoridades institucionales, roles de edición/diseño, ISBN, colofones y redes/URLs en páginas iniciales (nunca los dejes como `heading` o `quote`).',
  '- `merge`: uní el chunk `id` con el siguiente si el primero quedó cortado a mitad de oración por salto de página.',
  '- `drop`: descartá directamente con `reason` breve en español cuando es suciedad o relleno evidente: texto placeholder / lorem ipsum / pseudo-latín de plantilla (ej. `Evel evelia...`, `Omnist expligenesti...`, `Lorem ipsum...`), etiquetas de plantilla/maquetación (`E2 a E3`), etiquetas de conversión/versión (`ePUB v2.1`, `Calibre`, `Converted by...`), banners o marcas de sitios de descarga (`Le Libros`, `Descargar Libros Gratis`, `Lectulandia`, `epublibre`, `z-lib`), tags rotos tipo `Imagen svg: ...`, caracteres Unicode corruptos / mojibake / símbolos sin sentido (``, `Ã±`, secuencias `/ToUnicode` rotas), números de página sueltos o encabezados/pies de página repetidos.',
  '- `recommend_drop`: recomendá descartar con `reason` breve en español cuando es contenido extra dudoso que no borrás automáticamente pero conviene que revise el editor (ej: título suelto en idioma original como `陰翳礼讃` en un libro traducido, avisos de ISBN/copyright, colofones o créditos de edición).',
  '- Si un chunk ya está bien clasificado, NO emitas parche para ese `id`.',
  'Respondé SOLO con JSON válido, sin markdown ni comentarios:',
  '{"patches":[{"op":"reclassify","id":"...","type":"heading","level":1},{"op":"merge","id":"..."},{"op":"drop","id":"...","reason":"Banner de sitio de descarga"},{"op":"recommend_drop","id":"...","reason":"Título suelto en idioma original"}]}',
].join('\n');

export const REFINER_PASS2_SYSTEM_PROMPT = [
  'Sos el auditor de diseño editorial de Ignit (lector Vigilia) realizando la SEGUNDA PASADA de revisión.',
  'Todos los libros de la plataforma deben compartir EXACTAMENTE el mismo diseño y jerarquía estructural de Vigilia.',
  'Ya se aplicó una primera pasada sobre este documento; tu trabajo ahora es corregir fallos residuales y unificar la estructura:',
  '- Verificá la jerarquía uniforme de títulos (`heading`): `level: 1` exclusivamente para partes/capítulos principales, `level: 2` para secciones y `level: 3` para subsecciones. Corregí cualquier nivel inconsistente o párrafo corto que en realidad sea título.',
  '- Verificá que NO queden metadatos editoriales, créditos, ISBN, URLs ni marcas de descarga (`Le Libros`, `Lectulandia`, `epublibre`, `Calibre`, etc.) disfrazados de `heading`, `quote` o `para`: pasalos a `meta` o `drop`.',
  '- Uní con `merge` cualquier párrafo que siga cortado a mitad de oración por salto de página tras los descartes de la pasada 1.',
  '- Descartá con `drop` cualquier suciedad residual, números de página sueltos, encabezados repetidos o caracteres Unicode/mojibake rotos.',
  '- NUNCA reescribas ni inventes texto: solo emití parches por `id`. Si todo ya cumple el estándar uniforme de Vigilia, devolvé `{"patches":[]}`.',
  'Respondé SOLO con JSON válido, sin markdown ni comentarios:',
  '{"patches":[{"op":"reclassify","id":"...","type":"heading","level":1},{"op":"merge","id":"..."},{"op":"drop","id":"...","reason":"..."}]}',
].join('\n');

/**
 * Splits structurally interesting chunks (front matter + short/ambiguous
 * blocks + page-boundary splits) into batches of up to `REFINER_CHAR_BUDGET`
 * characters (capped at `maxBatches`) so multi-chapter books are covered
 * beyond the first 18k characters.
 */
export function selectRefinerCandidateBatches(
  document: BookReadingDocument,
  maxBatches = 8,
): ReadingChunk[][] {
  const chunks = document.chunks;
  if (chunks.length === 0) {
    return [];
  }

  const candidates: ReadingChunk[] = [];
  const seen = new Set<string>();
  const pushCandidate = (chunk: ReadingChunk) => {
    if (seen.has(chunk.id)) return;
    seen.add(chunk.id);
    candidates.push(chunk);
  };

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const next = chunks[i + 1];
    const isFrontMatter = i < FRONT_MATTER_LIMIT;
    const isAmbiguousShort = chunk.text.length <= 160;
    const isSpecialType = chunk.type !== 'para';
    const isBrokenPageSplit =
      Boolean(next) &&
      chunk.page !== next.page &&
      chunk.type === 'para' &&
      !SENTENCE_END_RE.test(chunk.text);

    if (isFrontMatter || isAmbiguousShort || isSpecialType || isBrokenPageSplit) {
      pushCandidate(chunk);
      if (isBrokenPageSplit && next) {
        pushCandidate(next);
      }
    }
  }

  if (candidates.length === 0) return [];

  const batches: ReadingChunk[][] = [];
  let current: ReadingChunk[] = [];
  let currentChars = 0;

  for (const chunk of candidates) {
    const lineLen = formatChunkLine(chunk).length + 1;
    if (current.length > 0 && currentChars + lineLen > REFINER_CHAR_BUDGET) {
      batches.push(current);
      if (batches.length >= maxBatches) break;
      current = [];
      currentChars = 0;
    }
    current.push(chunk);
    currentChars += lineLen;
  }

  if (current.length > 0 && batches.length < maxBatches) {
    batches.push(current);
  }

  return batches;
}

export function selectRefinerCandidates(document: BookReadingDocument): ReadingChunk[] {
  return selectRefinerCandidateBatches(document, 1)[0] ?? [];
}

export function formatChunkLine(chunk: ReadingChunk): string {
  const clean = chunk.text.replace(/\s+/g, ' ').trim();
  const preview =
    clean.length > CHUNK_PREVIEW_LIMIT
      ? `${clean.slice(0, 160)} … ${clean.slice(-80)}`
      : clean;
  const levelTag = chunk.level ? `:L${chunk.level}` : '';
  return `[${chunk.id}|${chunk.type}${levelTag}|p${chunk.page}] ${preview}`;
}

export function refinerMessages(candidates: ReadingChunk[], pass: 1 | 2 = 1): ChatMessage[] {
  const userContent = candidates.map(formatChunkLine).join('\n');
  const systemPrompt = pass === 2 ? REFINER_PASS2_SYSTEM_PROMPT : REFINER_SYSTEM_PROMPT;
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
}
