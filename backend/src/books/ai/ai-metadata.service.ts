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
  'Sos un asistente bibliográfico y de cumplimiento legal estricto para una biblioteca digital en español (Ignit).',
  'Dado el nombre de archivo de un PDF/EPUB y/o su título y autor, identificá la obra y BUSCÁ su licencia y estado de derechos de autor antes de subirlo.',
  'Para `author`, usá el nombre con el que se publica habitualmente el autor (ej. "E. M. Forster", "J. R. R. Tolkien", "Jorge Luis Borges"), no nombres legales poco usados.',
  'Para `coverQueries`, devolvé 2 o 3 consultas cortas y efectivas para encontrar la portada en catálogos de libros (OpenLibrary, Wikimedia Commons, Google Books): primero título en español + autor habitual, y si la obra fue traducida incluí también el título original en su idioma original + autor (ej. ["La máquina se detiene E. M. Forster", "The Machine Stops E. M. Forster"]).',
  'REGLA CRÍTICA DE LICENCIA — evaluá si la obra puede compartirse en el catálogo público (que SOLO admite dominio público o licencias abiertas) o si es de licencia cerrada (solo biblioteca privada):',
  `- Si la obra está verificablemente en dominio público (autor fallecido hace más de 70 años y sin traducción moderna protegida) o se publica oficialmente bajo una licencia abierta (Creative Commons, documentación técnica open source, libros libres de programación), devolvé "licenseStatus":"open" y en "license" elegí EXACTAMENTE una de estas opciones: ${ALLOWED_LICENSES_LIST}.`,
  '- Si la obra tiene licencia cerrada o derechos de autor vigentes (libro comercial moderno, editorial con derechos reservados, novela contemporánea, manual propietario o bestseller protegido), devolvé "licenseStatus":"copyrighted" y "license":"" para bloquear su publicación en el catálogo público y permitir solo biblioteca privada.',
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

export type SuggestMetadataInput = {
  filename?: string;
  title?: string;
  author?: string;
};

/**
 * Fast fail-open LLM prefill and license check for the upload form (`title`,
 * `author`, `description`, `coverQueries`, `licenseStatus`) from the filename
 * and/or form title/author before the book is uploaded.
 */
export async function suggestMetadataFromInput(
  input: SuggestMetadataInput,
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
  const filename = (input.filename ?? '').trim().slice(0, 240);
  const title = (input.title ?? '').trim().slice(0, 180);
  const author = (input.author ?? '').trim().slice(0, 140);
  const endpoint = llmEndpoint(options.env ?? process.env);
  if (!endpoint || (!filename && !title && !author)) {
    return empty;
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return empty;
  }

  const parts = [
    filename ? `Archivo: ${filename}` : '',
    title ? `Título: ${title}` : '',
    author ? `Autor: ${author}` : '',
  ].filter(Boolean);

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
          { role: 'user', content: parts.join('\n') },
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
 * Fast fail-open LLM prefill for the upload form (`title`, `author`, `description`, `coverQueries`)
 * from the selected PDF filename before the file itself is uploaded.
 */
export function suggestMetadataFromFilename(
  rawFilename: string,
  options: AiAnalysisOptions = {},
): Promise<SuggestedBookMetadata> {
  return suggestMetadataFromInput({ filename: rawFilename }, options);
}

export type VerifyBookLicenseInput = {
  title?: string | null;
  author?: string | null;
  claimedLicense?: string | null;
  textSample: string;
};

const LICENSE_VERIFY_PROMPT = [
  'Sos un auditor legal y bibliográfico estricto para una biblioteca digital en español (Ignit).',
  'Recibís los metadatos y los primeros fragmentos extraídos de un libro (incluyendo portada, créditos, colofón o avisos legales si existen).',
  'Tu tarea es verificar si la obra puede publicarse en el catálogo público (SOLO dominio público o licencias abiertas) o si tiene licencia cerrada / derechos de autor vigentes:',
  `- Devolvé "licenseStatus":"open" y en "license" elegí EXACTAMENTE una de: ${ALLOWED_LICENSES_LIST}, ÚNICAMENTE si verificás que la obra está en dominio público (autor fallecido hace >70 años sin traducción moderna protegida) o tiene una licencia abierta explícita en el texto.`,
  '- Devolvé "licenseStatus":"copyrighted" y "license":"" si tiene derechos reservados ("Todos los derechos reservados", © reciente, editorial comercial, autor contemporáneo/fallecido hace <70 años) o licencia cerrada.',
  '- Devolvé "licenseStatus":"unknown" y "license":"" si no hay certeza suficiente.',
  'Respondé SOLO con JSON válido:',
  '{"license":"licencia exacta de la lista o vacío","licenseStatus":"open|copyrighted|unknown","licenseReason":"motivo breve en español"}',
].join('\n');

/**
 * Post-extraction license verification against the book's actual extracted
 * text (front matter, copyright notices, opening pages). Fails open to
 * `unknown` on transport/LLM errors so the fail-closed publish gate can
 * hold the book in pending review.
 */
export async function verifyLicenseFromBookContent(
  input: VerifyBookLicenseInput,
  options: AiAnalysisOptions = {},
): Promise<{
  license: string | null;
  licenseStatus: LicenseComplianceStatus;
  licenseReason: string | null;
}> {
  const fallback = { license: null, licenseStatus: 'unknown' as const, licenseReason: null };
  const endpoint = llmEndpoint(options.env ?? process.env);
  const sample = input.textSample.trim().slice(0, 4_000);
  if (!endpoint || sample.length === 0) {
    return fallback;
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return fallback;
  }

  const header = [
    input.title?.trim() ? `Título: ${input.title.trim().slice(0, 180)}` : '',
    input.author?.trim() ? `Autor: ${input.author.trim().slice(0, 140)}` : '',
    input.claimedLicense?.trim() ? `Licencia declarada: ${input.claimedLicense.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

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
          { role: 'system', content: LICENSE_VERIFY_PROMPT },
          { role: 'user', content: `${header}\n\nFragmento inicial del libro:\n${sample}` },
        ],
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? SUGGEST_TIMEOUT_MS),
    });

    if (!response.ok) return fallback;
    const parsed = extractJsonObject(await response.json());
    return parsed ? parseLicenseVerdict(parsed) : fallback;
  } catch {
    return fallback;
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
