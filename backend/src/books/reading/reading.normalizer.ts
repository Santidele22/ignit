import type { BookReadingDocument, ReadingChunk, ReadingZone } from './reading.types.js';
import { READING_EXTRACTOR_VERSION } from './reading.types.js';
import {
  CREDIT_ROLE_RE,
  EDITION_LINE_RE,
  FRONTMATTER_LEGAL_RE,
  PRINT_RUN_RE,
  TOC_HEADING_RE,
  isCorruptStrippedGlyphText,
  isExtractionNoiseText,
  isOcrNoiseArtifact,
  isValidRomanHeading,
  stripInlineArtifacts,
} from './reading.noise.js';

const TOC_COLUMN_HEADER_RE = /^(?:p[aá]ginas?|p[aá]g\.?)$/i;
const KEY_VALUE_META_LABEL_RE = /(?:^[A-ZÁÉÍÓÚÜÑ]{1,2}\s*:|:$)/;
const BACKMATTER_HEADING_RE =
  /^(?:colof[oó]n|[ií]ndice\s+(?:onom[aá]stico|anal[ií]tico|alfab[eé]tico)|acab[oó]se\s+de\s+imprimir|notas\s+finales)\b/i;
const BODY_CHAPTER_HEADING_RE =
  /^(?:cap[ií]tulo|parte|(?:primera|segunda|tercera|cuarta|quinta|sexta|s[eé]ptima|octava|novena|d[eé]cima)\s+parte|libro|secci[oó]n|pr[oó]logo|prefacio|introducci[oó]n|ep[ií]logo|(?:\d{1,2}|[IVXLCDM]{1,6})\s*·\s*\S)/i;
const INSTITUTION_HEADING_RE =
  /^universi(?:dad|ty|teit|t[àa]t|d[áa]d)\s+[A-ZÁÉÍÓÚÜÑ]/i;
const FRONTMATTER_CREDIT_RE =
  /^(?:pr[oó]logo\s+y\s+edici[oó]n|traducci[oó]n|posfacio|primera\s+edici[oó]n|dise[ñn]o\s+de|fondo\s+editorial|cr[eé]ditos\s+editoriales)\b/i;
const FRONTMATTER_HISTORICAL_PARATEXT_RE =
  /(?:casa\s+editora|dep[oó]sito\s+general|librer[ií]a\s+[«"']|imprenta\s+de\b|ejemplares\b|precedida\s+de\b|adornada\s+con\b|retrato\s+del\s+autor|desde\s+\d{4}\s+hasta\s+\d{4}|(?:primera|segunda|tercera|cuarta|quinta|sexta|s[eé]ptima|octava|novena|d[eé]cima(?:\s+quinta)?)\s+edici[oó]n|^\d{4}$)/i;

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
  if (FRONTMATTER_HISTORICAL_PARATEXT_RE.test(text)) return true;
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
  let tocHeadingPage: number | null = null;
  const hasHighRomanSequence = doc.chunks.some(
    (c) => c.type === 'heading' && /^(?:XL|XC)[IVX]*\.?$/.test(c.text.trim()),
  );

  for (const raw of doc.chunks) {
    let text =
      raw.type === 'toc' ||
      raw.type === 'code' ||
      raw.type === 'list' ||
      raw.type === 'meta' ||
      raw.type === 'verse'
        ? raw.text.replace(/\r\n?/g, '\n').trim()
        : stripInlineArtifacts(raw.text);

    if (raw.type === 'heading' || raw.type === 'para') {
      text = stripFrontmatterIconPrefix(text, raw.page);
    }

    if (!text) continue;
    const isContextualRomanLC =
      hasHighRomanSequence && raw.type === 'heading' && /^[LC]\.?$/.test(text);
    if (!isContextualRomanLC && isCorruptStrippedGlyphText(text, raw.type)) {
      continue;
    }
    if (
      raw.type !== 'code' &&
      raw.type !== 'toc' &&
      raw.type !== 'list' &&
      raw.type !== 'dialogue' &&
      text.length < 2 &&
      !(
        raw.type === 'heading' &&
        (isValidRomanHeading(text) || isContextualRomanLC || /^\d{1,3}$/.test(text))
      )
    ) {
      continue;
    }
    if (raw.type !== 'toc' && isExtractionNoiseText(text, raw.page, totalPages)) {
      continue;
    }
    if (raw.type !== 'toc' && isOcrNoiseArtifact(text, raw.type)) {
      continue;
    }
    if (zone === 'frontmatter' && raw.type === 'para' && /^[a-záéíóúüñ]{1,2}$/.test(text)) {
      continue;
    }

    let type = raw.type;
    let level = raw.level;

    // 1. Zone transitions
    if (totalPages >= 10 && raw.page >= totalPages - 2 && BACKMATTER_HEADING_RE.test(text)) {
      zone = 'backmatter';
    } else if (TOC_HEADING_RE.test(text)) {
      zone = 'toc';
      tocHeadingPage = raw.page;
    } else if (type === 'toc' && !isFakeKeyValueToc(text)) {
      zone = 'toc';
    }

    // 2. Skip TOC column headers without breaking TOC zone
    if (zone === 'toc' && TOC_COLUMN_HEADER_RE.test(text)) {
      continue;
    }

    // 2b. On the exact page of an ÍNDICE heading, unnumbered TOC lines must stay inside `toc`
    // and never become fake duplicate chapter headings before the body begins.
    if (zone === 'toc' && tocHeadingPage !== null && raw.page === tocHeadingPage && !TOC_HEADING_RE.test(text)) {
      if (type === 'heading') {
        type = 'para';
        level = undefined;
      }
      text = text.replace(/\s*\.{2,}\s*$/, '').trim();
      if (!text) continue;
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

    // 5. Exit TOC zone when real body prose or chapter heading begins (on pages after TOC heading)
    if (
      zone === 'toc' &&
      type !== 'toc' &&
      !TOC_HEADING_RE.test(text) &&
      (tocHeadingPage === null || raw.page > tocHeadingPage)
    ) {
      if (
        (type === 'heading' && (BODY_CHAPTER_HEADING_RE.test(text) || isValidRomanHeading(text))) ||
        (type === 'para' && text.length >= 120) ||
        raw.page > 12
      ) {
        zone = 'body';
      }
    }

    // 6. Frontmatter invariants & transition to body
    if (zone === 'frontmatter') {
      if (type === 'code' && !/[={}();]/.test(text) && !/\b(?:import|def|from|const|let|var|return)\b/.test(text)) {
        type = 'meta';
      }
      const isShortOrCapsParatext =
        text.length <= 95 || (text.length <= 160 && !/[a-záéíóúüñ]{3,}/.test(text));
      if (
        (type === 'heading' && isFrontmatterMetaHeading(text, raw.page)) ||
        (type === 'para' && isShortOrCapsParatext && FRONTMATTER_HISTORICAL_PARATEXT_RE.test(text))
      ) {
        type = 'meta';
        level = undefined;
      } else if (
        (type === 'heading' && (BODY_CHAPTER_HEADING_RE.test(text) || isValidRomanHeading(text))) ||
        (type === 'para' &&
          text.length >= 110 &&
          /[a-záéíóúüñ]{3,}/.test(text) &&
          !FRONTMATTER_CREDIT_RE.test(text) &&
          !(isShortOrCapsParatext && FRONTMATTER_HISTORICAL_PARATEXT_RE.test(text))) ||
        raw.page > 10
      ) {
        zone = 'body';
      }
    }

    // 7. Heading sanity: shell/git `# ...` comments -> code; footnotes & long sentence-like headings -> para
    if (type === 'heading') {
      text = text.replace(/^[TI]{2}\s+(?=[A-ZÁÉÍÓÚÜÑ]{4,})/, '');
      if (/^FIN[*“”"'`´]+$/i.test(text)) {
        text = 'FIN';
      }
      if (
        /^#\s+[A-Za-z]/.test(text) &&
        (text.length > 55 ||
          /\b(?:commit|branch|changes|please|enter|modified|untracked|staged|git|bash|zsh|sudo|chmod|export|echo)\b/i.test(
            text,
          ))
      ) {
        type = 'code';
        level = undefined;
      } else if (
        /^\d{1,3}\s+(?:-\s+)?[A-ZÁÉÍÓÚÜÑa-záéíóúüñ“"«']/.test(text) &&
        !/^\d{1,2}\s*·\s*\S/.test(text)
      ) {
        type = 'para';
        level = undefined;
      } else if (text.length > 100 && (/[.,]$/.test(text) || /\.\s+[A-ZÁÉÍÓÚÜÑ]/.test(text))) {
        type = 'para';
        level = undefined;
      }
    }

    const prevOut = outChunks[outChunks.length - 1];
    if (
      zone === 'frontmatter' &&
      type === 'meta' &&
      prevOut &&
      prevOut.zone === 'frontmatter' &&
      prevOut.type === 'meta' &&
      prevOut.page === raw.page
    ) {
      prevOut.text = `${prevOut.text}\n${text}`;
      delete prevOut.runs;
      continue;
    }

    const nextChunk: ReadingChunk = {
      ...raw,
      type,
      text,
      zone,
      ...(text !== raw.text ? { runs: undefined } : {}),
    };
    if (
      (type === 'para' || type === 'quote') &&
      raw.runs &&
      raw.runs.length === 1 &&
      raw.runs[0].marks?.includes('code') &&
      text.length > 45 &&
      !/[={}();]/.test(text)
    ) {
      delete nextChunk.runs;
    }
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
