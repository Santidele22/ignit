import type { PdfLine, PdfXmlPage, RawExtractedBlock } from './reading.types.js';
import {
  BULLET_LIST_RE,
  CAPTION_RE,
  CREDIT_ROLE_RE,
  DEDICATION_PREFIX_RE,
  EDITION_LINE_RE,
  FRONTMATTER_LEGAL_RE,
  PRINT_RUN_RE,
  SECTION_NUM_L2_RE,
  SECTION_NUM_L3_RE,
  STANDALONE_PAGE_NUMBER_RE,
  STANDALONE_ROMAN_FOLIO_RE,
  STANDALONE_URL_RE,
  dehyphenateLinePair,
  isRepeatedLineCandidate,
  normalizeEdgeKey,
} from './reading.noise.js';
import { dehyphenateRuns } from './reading.pdf-xml.js';

function parseTocPageToken(raw: string): string | null {
  const token = raw.trim();
  if (!token) return null;
  if (/^\d{1,4}$/.test(token)) {
    const n = Number(token);
    return n >= 1 && n <= 4000 ? token : null;
  }
  if (/^[ivxlcdm]{1,6}$/i.test(token)) {
    if (/^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/i.test(token)) {
      return token;
    }
  }
  return null;
}

const TOC_INLINE_LEADER_RE =
  /^(.+?)\s*(?:\.(?:\s*\.){1,}|[-–—_·•]{2,})\s*(\d{1,4}|[ivxlcdm]{1,6})\s*$/i;
const TOC_SINGLE_LINE_PAGE_RE =
  /^(\d+(?:\.\d+)*\s+.+?|[A-ZÁÉÍÓÚÜÑ][^.!?]{2,110}?)\s+(\d{1,4}|[ivxlcdm]{1,6})\s*$/i;

export function parseXmlTocLine(
  line: PdfLine,
  inTocPage: boolean,
): { label: string; pageToken: string } | null {
  const leaderMatch = line.text.match(TOC_INLINE_LEADER_RE);
  if (leaderMatch) {
    const label = leaderMatch[1].trim();
    const pageToken = parseTocPageToken(leaderMatch[2]);
    if (label && pageToken) return { label, pageToken };
  }

  if (line.segments.length >= 2) {
    const lastSeg = line.segments[line.segments.length - 1];
    const pageToken = parseTocPageToken(lastSeg.text);
    if (pageToken) {
      const label = line.segments
        .slice(0, -1)
        .map((s) => s.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (label && !label.endsWith('.')) {
        return { label, pageToken };
      }
    }
  }

  if (inTocPage) {
    const singleMatch = line.text.match(TOC_SINGLE_LINE_PAGE_RE);
    if (singleMatch) {
      const label = singleMatch[1].trim();
      const pageToken = parseTocPageToken(singleMatch[2]);
      if (label && pageToken && !label.endsWith('.')) {
        return { label, pageToken };
      }
    }
  }

  return null;
}

const RUNNING_HEADER_EDGE_RE =
  /^(?:secci[oó]n\s+\d+(?:\.\d+)*|cap[ií]tulo\s+(?:\d+|[ivxlcdm]+)|contenido|sumario|[íi]ndice)$/i;

export function isEdgeRunningLine(line: PdfLine, pageHeight: number, bodySize: number): boolean {
  const inTopBand = line.top < pageHeight * 0.11;
  const inBottomBand = line.bottom > pageHeight * 0.91;
  if (!inTopBand && !inBottomBand) return false;
  if (line.fontSize > bodySize * 1.18) return false;
  if (STANDALONE_PAGE_NUMBER_RE.test(line.text)) return true;
  if (STANDALONE_ROMAN_FOLIO_RE.test(line.text)) return true;
  if (line.segments.some((s) => RUNNING_HEADER_EDGE_RE.test(s.text.trim()))) {
    return true;
  }
  return false;
}

export function inferHeadingLevelFromText(text: string, fontSize: number, bodySize: number): 1 | 2 | 3 {
  if (SECTION_NUM_L3_RE.test(text)) return 3;
  if (SECTION_NUM_L2_RE.test(text)) return 2;
  if (fontSize >= bodySize * 1.45) return 1;
  if (/^(?:cap[ií]tulo|parte|pr[oó]logo|prefacio|justificaci[oó]n|introducci[oó]n|ep[ií]logo|contenido|[íi]ndice)\b/i.test(text)) {
    return 1;
  }
  if (/^(?:\d{1,2}|[IVXLCDM]{1,6})\s*·\s*/.test(text)) {
    return 1;
  }
  if (fontSize >= bodySize * 1.11) return 2;
  return 3;
}

export function isStandaloneChapterNumber(line: PdfLine, bodySize: number): boolean {
  return (
    (line.fontSize >= bodySize * 1.4 || (line.isCentered && line.fontSize >= bodySize * 1.11)) &&
    (/^\d{1,2}$/.test(line.text.trim()) || /^[IVXLCDM]{1,6}$/.test(line.text.trim()))
  );
}

export function isFrontmatterMetaLine(
  line: PdfLine,
  pageNum: number,
  totalPages: number,
  bodySize: number,
): boolean {
  const isEdgePage = pageNum <= 10 || pageNum >= totalPages - 2;
  if (!isEdgePage) return false;
  const t = line.text.trim();
  if (PRINT_RUN_RE.test(t)) return true;
  if (EDITION_LINE_RE.test(t)) return true;
  if (CREDIT_ROLE_RE.test(t)) return true;
  if (STANDALONE_URL_RE.test(t)) return true;
  if (FRONTMATTER_LEGAL_RE.test(t)) return true;
  if (pageNum <= 8 && line.fontSize <= bodySize * 1.25) {
    if (
      /^(?:campus\s+|instituto\s+tecnol[oó]gico|universidad\s+de|departamento\s+acad[eé]mico|catedr[aá]tico\s+del|ingeniero\s+en\s+|vrije\s+universiteit|amsterdam,\s*holanda|[áa]rea:\s*|formato:\s*|pearson\s+educaci[oó]n|prentice\s+hall|esta\s+edici[oó]n\s+en\s+espa[ñn]ol)/i.test(
        t,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function isDedicationLine(
  line: PdfLine,
  pageNum: number,
  bodySize: number,
): boolean {
  if (pageNum > 10) return false;
  const t = line.text.trim();
  if (t.length > 140) return false;
  if (FRONTMATTER_LEGAL_RE.test(t) || CREDIT_ROLE_RE.test(t)) return false;
  if (/\b(?:informaci[oó]n|visite|p[aá]gina|web|sitio|cap[ií]tulo|secci[oó]n|edici[oó]n)\b/i.test(t)) {
    return false;
  }
  return DEDICATION_PREFIX_RE.test(t) || (line.isItalic && line.fontSize >= bodySize * 0.95 && /^Para\s+[A-ZÁÉÍÓÚÜÑ]/.test(t));
}

export function collectRepeatedEdgeKeys(
  pages: readonly PdfXmlPage[],
  pageLinesList: readonly PdfLine[][],
  bodySize: number,
  totalPages: number,
): Set<string> {
  const edgeKeyPages = new Map<string, Set<number>>();
  pageLinesList.forEach((lines, pageIdx) => {
    const pageHeight = pages[pageIdx].height;
    for (const line of lines) {
      const inEdgeBand = line.top < pageHeight * 0.11 || line.bottom > pageHeight * 0.91;
      if (!inEdgeBand || line.fontSize > bodySize * 1.18) continue;
      if (!isRepeatedLineCandidate(line.text)) continue;
      const key = normalizeEdgeKey(line.text);
      if (!key) continue;
      const set = edgeKeyPages.get(key) ?? new Set<number>();
      set.add(pageIdx);
      edgeKeyPages.set(key, set);
    }
  });
  const repeatedEdgeKeys = new Set<string>();
  for (const [key, pageSet] of edgeKeyPages.entries()) {
    const minPages = totalPages <= 6 ? 2 : 3;
    if (pageSet.size >= minPages) repeatedEdgeKeys.add(key);
  }
  return repeatedEdgeKeys;
}

export function mergeCrossPageParagraphs(
  rawBlocks: readonly RawExtractedBlock[],
): RawExtractedBlock[] {
  const mergedBlocks: RawExtractedBlock[] = [];
  for (const block of rawBlocks) {
    const prev = mergedBlocks[mergedBlocks.length - 1];
    if (
      prev &&
      prev.type === 'para' &&
      block.type === 'para' &&
      block.page === prev.page + 1 &&
      !prev.endsWithSentencePunct &&
      !block.firstLineIndented &&
      (block.startsLowercase || /[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]{2}-$/.test(prev.text))
    ) {
      const nextText = dehyphenateLinePair(prev.text, block.text);
      const prevRuns = prev.runs ?? [{ text: prev.text }];
      const nextRuns = block.runs ?? [{ text: block.text }];
      const combinedRuns = dehyphenateRuns(prevRuns, nextRuns);
      prev.text = nextText;
      prev.runs = combinedRuns.some((r) => r.marks && r.marks.length > 0) ? combinedRuns : undefined;
      prev.endsWithSentencePunct = block.endsWithSentencePunct;
      continue;
    }
    mergedBlocks.push(block);
  }
  return mergedBlocks;
}

export function collectSuppressedLabelIndices(
  lines: readonly PdfLine[],
  bodySize: number,
): Set<number> {
  const suppressedIndices = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (!CAPTION_RE.test(lines[i].text)) continue;
    const capTop = lines[i].top;
    const candidates: number[] = [];
    for (let j = i - 1; j >= 0; j--) {
      const cand = lines[j];
      if (capTop - cand.top > 300) break;
      const isSmallLabel =
        cand.fontSize <= bodySize * 0.9 &&
        cand.text.length <= 44 &&
        !BULLET_LIST_RE.test(cand.text) &&
        !/[.!?]$/.test(cand.text);
      if (isSmallLabel) {
        candidates.push(j);
      } else {
        break;
      }
    }
    if (candidates.length >= 2) {
      for (const idx of candidates) suppressedIndices.add(idx);
    }
  }
  return suppressedIndices;
}
