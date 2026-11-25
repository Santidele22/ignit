import type { PdfLine } from './reading.types.js';

export const TOC_LINE_RE = /(?:(?:\.\s*){3,}|\.{3,}\s*)\d+\s*$/;
export const TOC_HEADING_RE =
  /^(?:índice(?:\s+general|\s+de\s+contenidos)?|indice(?:\s+general|\s+de\s+contenidos)?|tabla de contenidos|contenidos?|sumario|index|table of contents):?$/i;
export const CHAPTER_HEADING_RE =
  /^(?:cap[íi]tulo|parte|secci[óo]n|pr[óo]logo|ep[íi]logo|nota|prefacio|introducci[óo]n|conclusi[óo]n|[ivxlcdm]+\b|\d+(?:\.\d+)*[.)]?\s)/i;
export const SECTION_NUM_L3_RE = /^\d+\.\d+\.\d+(?:\.\d+)*\s+\S/;
export const SECTION_NUM_L2_RE = /^\d+\.\d+\s+\S/;
export const CAPTION_RE = /^(?:Figura|Fig\.?|Tabla|Cuadro|Gr[aá]fico|Esquema)\s+\d+(?:[.-]\d+)?\.?(?:\s|$)/i;
export const BULLET_LIST_RE = /^[•◦▪▫●○]\s*(.+)$/;
export const DASH_LIST_RE = /^[-*–]\s+(.+)$/;
export const ORDERED_LIST_RE = /^(?:(\d+)[.)]|\((\d+)\)|([a-zA-Z])[.)])\s+(.+)$/;

const KNOWN_EBOOK_SITES_RE =
  /\b(?:lelibros|lectulandia|ebookelo|epublibre|bajalibros|elejandria|espaebook|quedelibros|epubgratis|librodot|freeditorial|pdfdrive|z-lib|libgen)\b/i;
const EBOOK_PROMO_PHRASES_RE =
  /(?:libro\s+proporcionado\s+por|proporcionado\s+por\s+el\s+equipo|visite\s+nuestro\s+sitio|visita\s+nuestr[oa]\s+(?:sitio|web)|descarga\s+est[eo]\s+y\s+otros\s+(?:miles\s+de\s+)?libros)/i;
const DOMAIN_PAGE_WATERMARK_EXACT_RE =
  /^(?:(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\s*[-–—|·/]\s*(?:p[aá]gina|page|p[aá]g\.?)\s*\d+(?:\s*(?:de|of|\/)\s*\d+)?|(?:p[aá]gina|page|p[aá]g\.?)\s*\d+(?:\s*(?:de|of|\/)\s*\d+)?\s*[-–—|·/]\s*(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i;
const DOMAIN_PAGE_WATERMARK_INLINE_EDGE_RE =
  /(?:^\s*(?:(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\s*[-–—|·/]\s*(?:p[aá]gina|page|p[aá]g\.?)\s*\d+(?:\s*(?:de|of|\/)\s*\d+)?|(?:p[aá]gina|page|p[aá]g\.?)\s*\d+(?:\s*(?:de|of|\/)\s*\d+)?\s*[-–—|·/]\s*(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+)\s+|\s+(?:(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\s*[-–—|·/]\s*(?:p[aá]gina|page|p[aá]g\.?)\s*\d+(?:\s*(?:de|of|\/)\s*\d+)?|(?:p[aá]gina|page|p[aá]g\.?)\s*\d+(?:\s*(?:de|of|\/)\s*\d+)?\s*[-–—|·/]\s*(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+)\s*$)/gi;
export const STANDALONE_PAGE_NUMBER_RE =
  /^(?:[-–—[(]?\s*\d{1,4}\s*[-–—\])]|(?:p[aá]gina|page|p[aá]g\.?)\s*\d{1,4}(?:\s*(?:de|of|\/)\s*\d{1,4})?|\d{1,4}\/\d{1,4}|\d{1,4})$/i;
export const STANDALONE_ROMAN_FOLIO_RE = /^[ivxlcdm]{1,6}$/i;
export const STANDALONE_URL_RE =
  /^(?:https?:\/\/\S+|www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?|[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S+)$/i;
const PRINT_PDF_URL_LEADING_RE =
  /^\s*(?:https?:\/\/|www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S+(?:\s+\d{1,4}\/\d{1,4})?(?:\s+|$)/i;
const PRINT_PDF_URL_TRAILING_RE =
  /(?:\s+|^)(?:https?:\/\/|www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S+(?:\s+\d{1,4}\/\d{1,4})?\s*$/i;
const LEADING_PAGE_FRACTION_RE = /^\s*\d{1,4}\/\d{1,4}\s+(?=[a-záéíóúüñ,;:])/;
const EPUB_STAMP_RE = /\bepub\s+(?:base\s+)?r\d+(?:\.\d+)*\b/i;
const RIPPER_CREDIT_PREFIX_RE =
  /^(?:editor\s+digital|digitalizado\s+por|escaneado\s+por|maquetado\s+por|maquetaci[oó]n|correcci[oó]n\s+de\s+erratas|conversi[oó]n\s+a\s+(?:pdf|epub))\b/i;
const RIPPER_CREDIT_ANYWHERE_RE = /\b(?:digitalizado|escaneado|maquetado)\s+por\b/i;
const RIPPER_DATE_SIG_RE =
  /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_.-]{2,28}(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_.-]{2,20})?\s+\d{2}\.\d{2}\.\d{2,4}$/;
export const FRONTMATTER_LEGAL_RE =
  /(?:\bisbn(?:-1[03])?\s*[:-]?\s*[\dXx-]{10,}|^isbn\b|dep[oó]sito\s+legal|todos\s+los\s+derechos\s+reservados|reservados\s+todos\s+los\s+derechos|no\s+se\s+permite\s+la\s+reproducci[oó]n\s+total\s+o\s+parcial|^(?:copyright\s*)?©|^(?:t[ií]tulo\s+original|edici[oó]n\s+original|dise[ñn]o\s+de\s+(?:cubierta|portada)|ilustraci[oó]n\s+de\s+(?:cubierta|portada)|impreso\s+en|printed\s+in)\b)/i;
const EDGE_HEADER_CHAPTER_RE =
  /^(?:cap[íi]tulo|parte|secci[óo]n|pr[óo]logo|ep[íi]logo|[íi]ndice|tabla\s+de\s+contenidos|contenido|sumario|index|table\s+of\s+contents|[ivxlcdm]+)(?:\s+(?:[ivxlcdm]+|\d+(?:\.\d+)*))?\.?$/i;
export const PRINT_RUN_RE = /^\d{2}(?:\s+\d{2}){2,12}$/;
export const EDITION_LINE_RE =
  /^(?:\d+[ªaºo]?\s+edici[oó]n|(?:primera|segunda|tercera|cuarta|quinta|sexta|s[eé]ptima|octava|novena|d[eé]cima)\s+edici[oó]n|(?:first|second|third|fourth|fifth|sixth)\s+edition)\.?$/i;
export const CREDIT_ROLE_RE =
  /^(?:traducci[oó]n|revisi[oó]n\s+t[eé]cnica|revisi[oó]n|edici[oó]n\s+t[eé]cnica|edici[oó]n\s+en\s+(?:espa[ñn]ol|ingl[eé]s)|coordinaci[oó]n|supervisi[oó]n|direcci[oó]n|compilaci[oó]n|prefacio\s+a\s+la\s+edici[oó]n|para\s+mayor\s+informaci[oó]n\s+visite|datos\s+de\s+catalogaci[oó]n|authorized\s+translation|traducci[oó]n\s+autorizada)\b/i;
export const DEDICATION_PREFIX_RE =
  /^(?:Para\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{1,30}|[Aa]\s+la\s+memoria\s+de\b|[Aa]\s+mi\s+|[Dd]edicado\s+a\b|[Ii]n\s+memory\s+of\b|[Tt]o\s+my\b)/;

export function normalizeEdgeKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(?:pagina|page|pag\.?)\s*\d+(?:\s*(?:de|of|\/)\s*\d+)?\b/g, 'pagina #')
    .replace(/^\d+(?:\s*[-–—|·]\s*|\s+)/g, '# ')
    .replace(/(?:\s*[-–—|·]\s*|\s+)\d+$/g, ' #')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isRepeatedLineCandidate(line: string): boolean {
  const trimmed = line.replace(/\s+/g, ' ').trim();
  if (!trimmed || trimmed.length > 100) return false;
  if (trimmed.startsWith('—')) return false;
  if (EDGE_HEADER_CHAPTER_RE.test(trimmed)) return false;
  const key = normalizeEdgeKey(trimmed);
  const hasMarker =
    key.includes('#') || /\b(?:https?:\/\/|www\.|\.[a-z]{2,4})\b/i.test(trimmed);
  if (!hasMarker && /[.!?;:»"]$/.test(trimmed)) return false;
  return Boolean(key);
}

export function cleanPageTextsForExtraction(pageTexts: string[]): string[] {
  const totalPages = pageTexts.length;
  if (totalPages === 0) return [];

  const keyPages = new Map<string, Set<number>>();
  const splitLinesPerPage = pageTexts.map((raw) => raw.replace(/\r\n/g, '\n').split('\n'));

  splitLinesPerPage.forEach((lines, pageIdx) => {
    const nonEmptyIndices: number[] = [];
    lines.forEach((line, idx) => {
      if (line.trim()) nonEmptyIndices.push(idx);
    });
    if (nonEmptyIndices.length === 0) return;

    const edgeIndices =
      nonEmptyIndices.length === 1
        ? [nonEmptyIndices[0]]
        : [nonEmptyIndices[0], nonEmptyIndices[nonEmptyIndices.length - 1]];

    for (const idx of edgeIndices) {
      const line = lines[idx].replace(/\s+/g, ' ').trim();
      if (!isRepeatedLineCandidate(line)) continue;
      const key = normalizeEdgeKey(line);
      if (!key) continue;
      const pages = keyPages.get(key) ?? new Set<number>();
      pages.add(pageIdx);
      keyPages.set(key, pages);
    }
  });

  const repeatedKeys = new Set<string>();
  for (const [key, pages] of keyPages.entries()) {
    const hasMarker =
      key.includes('#') || /(?:https?:\/\/|www\.|\.(?:com|org|net|es|info|io)\b)/i.test(key);
    const minPages = totalPages <= 6 && hasMarker ? 2 : 3;
    if (pages.size >= minPages) {
      repeatedKeys.add(key);
    }
  }

  return splitLinesPerPage.map((lines) => {
    const nonEmptyIndices: number[] = [];
    lines.forEach((line, idx) => {
      if (line.trim()) nonEmptyIndices.push(idx);
    });
    if (nonEmptyIndices.length === 0) return '';

    const edgeSet = new Set(
      nonEmptyIndices.length === 1
        ? [nonEmptyIndices[0]]
        : [nonEmptyIndices[0], nonEmptyIndices[nonEmptyIndices.length - 1]],
    );

    const filtered = lines.filter((line, idx) => {
      if (!edgeSet.has(idx)) return true;
      const trimmed = line.replace(/\s+/g, ' ').trim();
      if (!isRepeatedLineCandidate(trimmed)) return true;
      const key = normalizeEdgeKey(trimmed);
      return !(key && repeatedKeys.has(key));
    });

    return filtered.join('\n');
  });
}

export function stripInlineArtifacts(text: string): string {
  let cleaned = text.trim();
  if (!cleaned) return '';

  for (let i = 0; i < 3; i++) {
    const next = cleaned
      .replace(DOMAIN_PAGE_WATERMARK_INLINE_EDGE_RE, ' ')
      .replace(PRINT_PDF_URL_LEADING_RE, '')
      .replace(PRINT_PDF_URL_TRAILING_RE, '')
      .replace(LEADING_PAGE_FRACTION_RE, '')
      .replace(/\s+https?:\/\/(?:www\.)?(?:lelibros|lectulandia|ebookelo|epublibre|bajalibros|elejandria|espaebook|quedelibros|epubgratis|librodot)[^\s]*$/i, '')
      .replace(/^https?:\/\/(?:www\.)?(?:lelibros|lectulandia|ebookelo|epublibre|bajalibros|elejandria|espaebook|quedelibros|epubgratis|librodot)[^\s]*\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (next === cleaned) break;
    cleaned = next;
  }
  return cleaned;
}

export function isExtractionNoiseText(text: string, pageNum?: number, totalPages?: number): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (STANDALONE_PAGE_NUMBER_RE.test(trimmed)) return true;
  if (DOMAIN_PAGE_WATERMARK_EXACT_RE.test(trimmed)) return true;
  if (EBOOK_PROMO_PHRASES_RE.test(trimmed) && trimmed.length <= 280) return true;
  if (KNOWN_EBOOK_SITES_RE.test(trimmed) && trimmed.length <= 220) return true;
  if (EPUB_STAMP_RE.test(trimmed) && trimmed.length <= 220) return true;
  if (RIPPER_CREDIT_PREFIX_RE.test(trimmed) && trimmed.length <= 240) return true;
  if (RIPPER_CREDIT_ANYWHERE_RE.test(trimmed) && trimmed.length <= 160) return true;

  const isEdgeMatter =
    typeof pageNum === 'number' &&
    (pageNum <= 8 || (typeof totalPages === 'number' && totalPages > 0 && pageNum >= totalPages - 3));

  if (STANDALONE_URL_RE.test(trimmed)) {
    if (KNOWN_EBOOK_SITES_RE.test(trimmed) || isEdgeMatter || /\//.test(trimmed)) return true;
  }

  if (isEdgeMatter) {
    if (RIPPER_DATE_SIG_RE.test(trimmed)) return true;
    if (trimmed.length <= 320 && FRONTMATTER_LEGAL_RE.test(trimmed)) return true;
  }

  return false;
}

export function dehyphenateLinePair(prev: string, next: string): string {
  const trimmedPrev = prev.trimEnd();
  const trimmedNext = next.trimStart();
  if (
    /[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]{2}-$/.test(trimmedPrev) &&
    /^[a-záéíóúüñ]/.test(trimmedNext)
  ) {
    return `${trimmedPrev.slice(0, -1)}${trimmedNext}`;
  }
  return `${trimmedPrev} ${trimmedNext}`;
}

const CODE_PREPROC_RE = /^\s*#\s*(?:define|include|ifdef|ifndef|endif|if|else|elif|pragma|undef)\b/;
const CODE_BLOCK_COMMENT_RE = /\/\*|\*\//;
const CODE_LINE_COMMENT_RE = /(?:^|\s)\/\/\s*\S/;
const CODE_DECL_KW_RE =
  /^\s*(?:typedef|struct|union|enum|class|interface|impl|trait|fn|func|function|def|public|private|protected|static|async|export|import|return|package|using|namespace)\b/;
const CODE_TYPE_DECL_RE =
  /^\s*(?:void|int|char|float|double|long|short|unsigned|signed|bool|boolean|size_t|const|let|var)\s+[a-zA-Z_*][a-zA-Z0-9_*,\s[\]]*(?:=|;|\(|$)/;
const CODE_CONTROL_RE = /^\s*(?:while|for|if|else\s+if|switch|catch)\s*\([^)]*\)\s*(?:\{|$)/;
const CODE_BRACE_ONLY_RE =
  /^\s*(?:\}\s*else(?:\s+if\b.*)?\s*\{?|\{\s*(?:int|char|void|return|if|while|for|const|let|var)?|\}\s*\}|\}\s*;?|[{}])\s*(?:\/\/.*|\/\*.*)?$/;
const CODE_CALL_OR_SIG_RE =
  /^\s*(?:[a-zA-Z_][a-zA-Z0-9_]*\s+)?[a-zA-Z_][a-zA-Z0-9_]*\([^()]*\)\s*(?:\{|:|;)?\s*$/;
const CODE_ASSIGN_RE =
  /^\s*[a-zA-Z_][a-zA-Z0-9_.->[\]]*\s*(?:=|:=|\+=|-=|\*=|\/=)\s*\S/;

export interface CodeScanState {
  inBlockComment: boolean;
  braceDepth: number;
}

export function updateCodeScanState(rawLine: string, state: CodeScanState): void {
  let i = 0;
  let inString: string | null = null;
  while (i < rawLine.length) {
    const ch = rawLine[i];
    const next = rawLine[i + 1];
    if (state.inBlockComment) {
      if (ch === '*' && next === '/') {
        state.inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      state.inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '/') {
      break;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      i += 1;
      continue;
    }
    if (ch === '{') state.braceDepth += 1;
    else if (ch === '}') state.braceDepth = Math.max(0, state.braceDepth - 1);
    i += 1;
  }
}

export function scoreCodeLine(rawLine: string): number {
  const line = rawLine.trim();
  if (!line) return 0;
  let score = 0;
  if (CODE_PREPROC_RE.test(line)) score += 3;
  if (CODE_BLOCK_COMMENT_RE.test(line)) score += 3;
  if (CODE_LINE_COMMENT_RE.test(line) && !/https?:\/\//i.test(line)) score += 2;
  if (CODE_DECL_KW_RE.test(line) && /[(){}=;:<>-]|:$/.test(line)) score += 2;
  if (CODE_TYPE_DECL_RE.test(line)) score += 2;
  if (CODE_CONTROL_RE.test(line)) score += 2;
  if (CODE_BRACE_ONLY_RE.test(line)) score += 2;
  if (CODE_CALL_OR_SIG_RE.test(line)) score += 2;
  if (
    /(?:;\s*$|;\s*(?:\/\*|\/\/))/.test(line) &&
    /[=()&*[\]]|->|\+\+|--|::|\b(?:typedef|int|void|return|const|let|var)\b/.test(line)
  ) {
    score += 2;
  } else if (CODE_ASSIGN_RE.test(line)) {
    score += 1;
  }
  return score;
}

export function isRawCodeBlock(rawLines: readonly string[]): boolean {
  const nonEmpty = rawLines.map((l) => l.trim()).filter(Boolean);
  if (nonEmpty.length < 2) return false;
  const state: CodeScanState = { inBlockComment: false, braceDepth: 0 };
  let totalScore = 0;
  let strongLines = 0;
  for (const line of nonEmpty) {
    const s = scoreCodeLine(line);
    const effective = s > 0 ? s : state.inBlockComment ? 1 : 0;
    totalScore += effective;
    if (effective >= 1) strongLines += 1;
    updateCodeScanState(line, state);
  }
  return totalScore >= 3 && strongLines >= 2;
}

export function dedentRawCodeLines(rawLines: readonly string[]): string[] {
  const expanded = rawLines.map((l) => l.replace(/\t/g, '  ').replace(/\s+$/, ''));
  let minIndent = Infinity;
  for (const line of expanded) {
    if (!line.trim()) continue;
    const match = line.match(/^ */);
    const indent = match ? match[0].length : 0;
    if (indent < minIndent) minIndent = indent;
  }
  const drop = Number.isFinite(minIndent) ? minIndent : 0;
  return expanded.map((line) => (line.trim() ? line.slice(drop) : ''));
}

export function formatXmlCodeLines(
  codeLines: readonly PdfLine[],
  bodyLineStep: number,
  bodySize: number,
): string {
  const minLeft = Math.min(...codeLines.map((l) => l.left));
  const refSize = codeLines[0]?.fontSize || bodySize;
  const charWidth = Math.max(5.5, refSize * 0.55);
  const out: string[] = [];
  for (let k = 0; k < codeLines.length; k++) {
    const cur = codeLines[k];
    if (k > 0 && cur.top - codeLines[k - 1].top >= bodyLineStep * 1.7) {
      out.push('');
    }
    const delta = cur.left - minLeft;
    const indent = delta < 6 ? 0 : Math.min(24, Math.round(delta / charWidth));
    out.push(`${' '.repeat(indent)}${cur.text}`);
  }
  return out.join('\n');
}

