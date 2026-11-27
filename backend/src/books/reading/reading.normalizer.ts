import type { BookReadingDocument, ReadingChunk, ReadingZone } from './reading.types.js';
import { READING_EXTRACTOR_VERSION } from './reading.types.js';
import {
  CREDIT_ROLE_RE,
  EDITION_LINE_RE,
  FRONTMATTER_LEGAL_RE,
  PRINT_RUN_RE,
  TOC_HEADING_RE,
  isExtractionNoiseText,
  stripInlineArtifacts,
} from './reading.noise.js';

const TOC_COLUMN_HEADER_RE = /^(?:p[aá]ginas?|p[aá]g\.?)$/i;
const KEY_VALUE_META_LABEL_RE = /(?:^[A-ZÁÉÍÓÚÜÑ]{1,2}\s*:|:$)/;
const BACKMATTER_HEADING_RE =
  /^(?:colof[oó]n|[ií]ndice\s+(?:onom[aá]stico|anal[ií]tico|alfab[eé]tico)|acab[oó]se\s+de\s+imprimir|notas\s+finales)\b/i;
const BODY_CHAPTER_HEADING_RE =
  /^(?:cap[ií]tulo|parte|libro|secci[oó]n|pr[oó]logo|prefacio|introducci[oó]n|ep[ií]logo|(?:\d{1,2}|[IVXLCDM]{1,6})\s*·\s*\S)/i;
const INSTITUTION_HEADING_RE =
  /^universi(?:dad|ty|teit|t[àa]t|d[áa]d)\s+[A-ZÁÉÍÓÚÜÑ]/i;
const FRONTMATTER_CREDIT_RE =
  /^(?:pr[oó]logo\s+y\s+edici[oó]n|traducci[oó]n|posfacio|primera\s+edici[oó]n|dise[ñn]o\s+de|fondo\s+editorial|cr[eé]ditos\s+editoriales)\b/i;

function stripFrontmatterIconPrefix(text: string, page: number): string {
  if (page > 6) return text;
  return text.replace(/^(?:[a-z]\s+){1,4}(?=[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+\s)/, '').trim();
}

function isFakeKeyValueToc(text: string): boolean {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;
  let metaLikeCount = 0;
  for (const line of lines) {
    const parts = line.split(/\t+|[ ]{2,}/);
    if (parts.length < 2) continue;
    const label = parts.slice(0, -1).join(' ').trim();
    const token = parts[parts.length - 1].trim();
    if (
      KEY_VALUE_META_LABEL_RE.test(label) ||
      (/^[CDLM]$/.test(token) && label.length <= 4) ||
      (/^\d{4}$/.test(token) && Number(token) >= 1500 && Number(token) <= 2100 && label.length <= 16)
    ) {
      metaLikeCount += 1;
    }
  }
  return metaLikeCount > 0 && metaLikeCount >= Math.ceil(lines.length * 0.5);
}

function parseInlineChapterToc(text: string): string | null {
  const flat = text.replace(/\s+/g, ' ').trim();
  const entryRe =
    /((?:DEDICATORIA|PR[ÓO]LOGO|EP[ÍI]LOGO|CAP[IÍ]TULO|PARTE)\b[^]*?)\s+(\d{1,4})(?=\s+(?:DEDICATORIA|PR[ÓO]LOGO|EP[ÍI]LOGO|CAP[IÍ]TULO|PARTE)\b|\s*$)/gi;
  const matches = [...flat.matchAll(entryRe)];
  if (matches.length < 2) return null;
  const lines: string[] = [];
  for (const m of matches) {
    const label = m[1].replace(/[.\s]+$/, '').trim();
    const page = Number(m[2]);
    if (!label || !Number.isFinite(page) || page < 1 || page > 5000) return null;
    lines.push(`${label}\t${page}`);
  }
  return lines.join('\n');
}

function parseMultiPageFirstToc(text: string): string | null {
  const flat = text.replace(/\s+/g, ' ').trim();
  const re =
    /(?:^|\s)(\d{1,4})\s+([A-ZÁÉÍÓÚÜÑ¿¡«"][^\d]{1,80}?)(?=\s+\d{1,4}\s+[A-ZÁÉÍÓÚÜÑ¿¡«"]|\s*$)/g;
  const matches = [...flat.matchAll(re)];
  if (matches.length < 2) return null;
  return matches.map((m) => `${m[2].trim()}\t${m[1]}`).join('\n');
}

function isFrontmatterMetaHeading(text: string, page: number): boolean {
  if (page > 10) return false;
  if (INSTITUTION_HEADING_RE.test(text)) return true;
  if (PRINT_RUN_RE.test(text) || EDITION_LINE_RE.test(text) || CREDIT_ROLE_RE.test(text)) {
    return true;
  }
  if (FRONTMATTER_LEGAL_RE.test(text) || FRONTMATTER_CREDIT_RE.test(text)) return true;
  return false;
}

/**
 * Pure, idempotent, zone-aware normalizer for `BookReadingDocument`:
 * enforces `frontmatter` -> `toc` -> `body` -> `backmatter` invariants so
 * Web, Desktop, and Mobile receive identical canonical chunks before `IGB1`.
 */
export function normalizeReadingDocument(
  doc: BookReadingDocument,
  _bookMeta?: { title?: string; author?: string } | null,
): BookReadingDocument {
  const totalPages = Math.max(1, doc.pdfPages);
  const outChunks: ReadingChunk[] = [];
  let zone: ReadingZone = doc.chunks[0] && doc.chunks[0].page > 10 ? 'body' : 'frontmatter';

  for (const raw of doc.chunks) {
    let text =
      raw.type === 'toc' || raw.type === 'code' || raw.type === 'list' || raw.type === 'meta'
        ? raw.text.replace(/\r\n?/g, '\n').trim()
        : stripInlineArtifacts(raw.text);

    if (raw.type === 'heading' || raw.type === 'para') {
      text = stripFrontmatterIconPrefix(text, raw.page);
    }

    if (!text) continue;
    if (raw.type !== 'code' && raw.type !== 'toc' && raw.type !== 'list' && text.length < 2) {
      continue;
    }
    if (raw.type !== 'toc' && isExtractionNoiseText(text, raw.page, totalPages)) {
      continue;
    }

    let type = raw.type;
    let level = raw.level;

    // 1. Zone transitions
    if (totalPages >= 10 && raw.page >= totalPages - 2 && BACKMATTER_HEADING_RE.test(text)) {
      zone = 'backmatter';
    } else if (TOC_HEADING_RE.test(text)) {
      zone = 'toc';
    } else if (type === 'toc' && !isFakeKeyValueToc(text)) {
      zone = 'toc';
    }

    // 2. Skip TOC column headers without breaking TOC zone
    if (zone === 'toc' && TOC_COLUMN_HEADER_RE.test(text)) {
      continue;
    }

    // 3. Convert fake key-value TOCs (e.g. `D R\tD\nP :\t1637`) into frontmatter meta
    if (type === 'toc' && isFakeKeyValueToc(text)) {
      type = 'meta';
      if (raw.page <= 10) zone = 'frontmatter';
    }

    // 4. Normalize inline chapter TOCs or multi-entry page-first TOCs
    if (type === 'para' && (zone === 'toc' || raw.page <= 10)) {
      const inlineToc = parseInlineChapterToc(text);
      if (inlineToc) {
        type = 'toc';
        text = inlineToc;
        zone = 'toc';
      } else if (zone === 'toc') {
        const pageFirstToc = parseMultiPageFirstToc(text);
        if (pageFirstToc) {
          type = 'toc';
          text = pageFirstToc;
        }
      }
    }

    // 5. Exit TOC zone when real body prose or chapter heading begins
    if (zone === 'toc' && type !== 'toc' && !TOC_HEADING_RE.test(text)) {
      if (
        (type === 'heading' && BODY_CHAPTER_HEADING_RE.test(text)) ||
        (type === 'para' && text.length >= 120) ||
        raw.page > 12
      ) {
        zone = 'body';
      }
    }

    // 6. Frontmatter invariants & transition to body
    if (zone === 'frontmatter') {
      if (type === 'heading' && isFrontmatterMetaHeading(text, raw.page)) {
        type = 'meta';
        level = undefined;
      } else if (
        (type === 'heading' && BODY_CHAPTER_HEADING_RE.test(text)) ||
        (type === 'para' && text.length >= 90 && !FRONTMATTER_CREDIT_RE.test(text)) ||
        raw.page > 10
      ) {
        zone = 'body';
      }
    }

    // 7. Heading sanity: shell/git `# ...` comments -> code; long sentence-like headings -> para
    if (type === 'heading') {
      if (
        /^#\s+[A-Za-z]/.test(text) &&
        (text.length > 55 ||
          /\b(?:commit|branch|changes|please|enter|modified|untracked|staged|git|bash|zsh|sudo|chmod|export|echo)\b/i.test(
            text,
          ))
      ) {
        type = 'code';
        level = undefined;
      } else if (text.length > 100 && (/[.,]$/.test(text) || /\.\s+[A-ZÁÉÍÓÚÜÑ]/.test(text))) {
        type = 'para';
        level = undefined;
      }
    }

    const nextChunk: ReadingChunk = {
      ...raw,
      type,
      text,
      zone,
      ...(text !== raw.text ? { runs: undefined } : {}),
    };
    if (level !== undefined) nextChunk.level = level;
    else delete nextChunk.level;
    if (nextChunk.runs === undefined) delete nextChunk.runs;

    outChunks.push(nextChunk);
  }

  return {
    ...doc,
    extractorVersion: Math.max(doc.extractorVersion ?? 0, READING_EXTRACTOR_VERSION),
    chunks: outChunks,
  };
}
