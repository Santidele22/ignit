import { isOpenLicense, OPEN_LICENSE_OPTIONS } from '../lib/open-licenses.js';
import { chatCompletionsUrl, llmEndpoint } from './ai-analysis.config.js';
import type { AiAnalysisOptions } from './ai-analysis.service.js';

export type LicenseComplianceStatus = 'open' | 'copyrighted' | 'unknown';

export type SuggestedBookMetadata = {
  title: string | null;
  author: string | null;
  description: string | null;
  coverQueries: string[];
  license: string | null;
  licenseStatus: LicenseComplianceStatus;
  licenseReason: string | null;
};

const SUGGEST_TIMEOUT_MS = 6_000;
const COVER_QUERY_EXPAND_TIMEOUT_MS = 4_000;

const ALLOWED_LICENSES_LIST = OPEN_LICENSE_OPTIONS.join(', ');

const METADATA_SYSTEM_PROMPT = [
  'Sos un asistente bibliográfico y de cumplimiento legal rápido para una biblioteca digital en español (Ignit).',
  'Dado el nombre de archivo de un PDF, inferí los metadatos del libro si lo reconocés o limpiá el título/autor del nombre.',
  'Para `author`, usá el nombre con el que se publica habitualmente el autor (ej. "E. M. Forster", "J. R. R. Tolkien", "Jorge Luis Borges"), no nombres legales poco usados.',
  'Para `coverQueries`, devolvé 2 o 3 consultas cortas y efectivas para encontrar la portada en catálogos de libros (OpenLibrary, Wikimedia Commons, Google Books): primero título en español + autor habitual, y si la obra fue traducida incluí también el título original en su idioma original + autor (ej. ["La máquina se detiene E. M. Forster", "The Machine Stops E. M. Forster"]).',
  'Además, evaluá el estado de licencia/derechos de autor de la obra para el catálogo público de Ignit (que SOLO admite dominio público o licencias abiertas):',
  `- Si la obra está verificablemente en dominio público (autor fallecido hace más de 70 años y sin traducción moderna protegida) o se publica oficialmente bajo una licencia abierta (Creative Commons, documentación técnica open source, libros libres de programación), devolvé "licenseStatus":"open" y en "license" elegí EXACTAMENTE una de estas opciones: ${ALLOWED_LICENSES_LIST}.`,
  '- Si la obra tiene derechos de autor vigentes (libro comercial moderno, editorial con derechos reservados, novela contemporánea o bestseller protegido), devolvé "licenseStatus":"copyrighted" y "license":"".',
  '- Si no podés identificar la obra o su licencia con certeza, devolvé "licenseStatus":"unknown" y "license":"".',
  '- En "licenseReason" escribí una explicación breve (1 oración en español) del motivo.',
  'Respondé SOLO con JSON válido, sin markdown ni comentarios:',
  '{"title":"título limpio o vacío","author":"nombre editorial habitual del autor o vacío","description":"sinopsis breve de 1 o 2 oraciones en español sobre la obra o vacío","coverQueries":["consulta 1","consulta 2"],"license":"licencia exacta de la lista o vacío","licenseStatus":"open|copyrighted|unknown","licenseReason":"motivo breve en español"}',
].join('\n');

const COVER_QUERY_EXPAND_PROMPT = [
  'Sos un asistente bibliográfico para buscar portadas de libros en OpenLibrary, Wikimedia Commons y Google Books.',
  'Dada una búsqueda de libro que no devolvió portadas, devolvé 2 o 3 consultas cortas alternativas de alto recall: título original en su idioma original + nombre editorial habitual del autor (ej. "The Machine Stops E. M. Forster") y variante corta título + apellido del autor.',
  'Respondé SOLO con JSON válido, sin markdown ni comentarios:',
  '{"queries":["consulta 1","consulta 2"]}',
].join('\n');

/**
 * Fast fail-open LLM prefill for the upload form (`title`, `author`, `description`, `coverQueries`)
 * from the selected PDF filename before the file itself is uploaded.
 */
export async function suggestMetadataFromFilename(
  rawFilename: string,
  options: AiAnalysisOptions = {},
): Promise<SuggestedBookMetadata> {
  const empty: SuggestedBookMetadata = {
    title: null,
    author: null,
    description: null,
    coverQueries: [],
    license: null,
    licenseStatus: 'unknown',
    licenseReason: null,
  };
  const filename = rawFilename.trim();
  const endpoint = llmEndpoint(options.env ?? process.env);
  if (!endpoint || filename.length === 0) {
    return empty;
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return empty;
  }

  try {
    const response = await fetchImpl(chatCompletionsUrl(endpoint.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify({
        model: endpoint.model,
        messages: [
          { role: 'system', content: METADATA_SYSTEM_PROMPT },
          { role: 'user', content: `Archivo: ${filename.slice(0, 240)}` },
        ],
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? SUGGEST_TIMEOUT_MS),
    });

    if (!response.ok) return empty;
    return parseSuggestedMetadata(await response.json());
  } catch {
    return empty;
  }
}

/**
 * Fast fail-open LLM helper invoked only when direct catalog cover queries
 * return zero relevant covers (e.g., Spanish title + full legal author name).
 */
export async function suggestCoverSearchQueries(
  rawQuery: string,
  options: AiAnalysisOptions = {},
): Promise<string[]> {
  const query = rawQuery.trim();
  const endpoint = llmEndpoint(options.env ?? process.env);
  if (!endpoint || query.length === 0) {
    return [];
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return [];
  }

  try {
    const response = await fetchImpl(chatCompletionsUrl(endpoint.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify({
        model: endpoint.model,
        messages: [
          { role: 'system', content: COVER_QUERY_EXPAND_PROMPT },
          { role: 'user', content: `Búsqueda: ${query.slice(0, 200)}` },
        ],
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? COVER_QUERY_EXPAND_TIMEOUT_MS),
    });

    if (!response.ok) return [];
    const parsed = extractJsonObject(await response.json());
    return parseQueryList(parsed?.queries);
  } catch {
    return [];
  }
}

function extractJsonObject(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = (choices[0] as { message?: { content?: unknown } } | null)?.message?.content;
  if (typeof content !== 'string') return null;

  const unfenced = content.replace(/```(?:json)?/gi, '').trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(unfenced.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseQueryList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const cleaned = entry.trim().slice(0, 140);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= 3) break;
  }
  return out;
}

function parseLicenseVerdict(parsed: Record<string, unknown>): {
  license: string | null;
  licenseStatus: LicenseComplianceStatus;
  licenseReason: string | null;
} {
  const rawStatus =
    typeof parsed.licenseStatus === 'string' ? parsed.licenseStatus.trim().toLowerCase() : '';
  const rawLicense =
    typeof parsed.license === 'string' && parsed.license.trim().length > 0
      ? parsed.license.trim().slice(0, 200)
      : null;
  const licenseReason =
    typeof parsed.licenseReason === 'string' && parsed.licenseReason.trim().length > 0
      ? parsed.licenseReason.trim().slice(0, 260)
      : null;

  if (rawStatus === 'copyrighted') {
    return {
      license: null,
      licenseStatus: 'copyrighted',
      licenseReason:
        licenseReason ??
        'Obra con derechos de autor vigentes: solo puede guardarse en tu biblioteca personal.',
    };
  }

  if (rawStatus === 'open' && isOpenLicense(rawLicense)) {
    return {
      license: rawLicense,
      licenseStatus: 'open',
      licenseReason,
    };
  }

  if (rawStatus === '' && isOpenLicense(rawLicense)) {
    return {
      license: rawLicense,
      licenseStatus: 'open',
      licenseReason,
    };
  }

  return {
    license: null,
    licenseStatus: 'unknown',
    licenseReason,
  };
}

export function parseSuggestedMetadata(payload: unknown): SuggestedBookMetadata {
  const empty: SuggestedBookMetadata = {
    title: null,
    author: null,
    description: null,
    coverQueries: [],
    license: null,
    licenseStatus: 'unknown',
    licenseReason: null,
  };
  const parsed = extractJsonObject(payload);
  if (!parsed) return empty;
  const clean = (val: unknown, max: number) =>
    typeof val === 'string' && val.trim().length > 0 ? val.trim().slice(0, max) : null;
  const verdict = parseLicenseVerdict(parsed);
  return {
    title: clean(parsed.title, 180),
    author: clean(parsed.author, 140),
    description: clean(parsed.description, 400),
    coverQueries: parseQueryList(parsed.coverQueries),
    ...verdict,
  };
}
