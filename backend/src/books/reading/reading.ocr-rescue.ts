import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { inferHeadingLevelFromText } from './reading.block-rules.js';
import { classifyChunkType, splitPageIntoParagraphs } from './reading.chunks.js';
import { assessTextLegibility } from './reading.legibility.js';
import { classifyMoodAndCues } from './reading.mood.js';
import {
  dehyphenateLinePair,
  isCorruptStrippedGlyphText,
  isExtractionNoiseText,
  isOcrNoiseArtifact,
  isValidRomanHeading,
} from './reading.noise.js';
import type { BookReadingDocument, ReadingChunk } from './reading.types.js';

const execFileAsync = promisify(execFile);
const MAX_SURGICAL_OCR_PAGES = 30;

let cachedTesseractLang: string | null = null;

async function resolveTesseractLang(): Promise<string> {
  if (cachedTesseractLang) return cachedTesseractLang;
  try {
    const { stdout } = await execFileAsync('/usr/bin/tesseract', ['--list-langs'], {
      timeout: 5_000,
    });
    const langs = new Set(
      stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    );
    if (langs.has('spa') && langs.has('eng')) {
      cachedTesseractLang = 'spa+eng';
    } else if (langs.has('spa')) {
      cachedTesseractLang = 'spa';
    } else {
      cachedTesseractLang = 'eng';
    }
  } catch {
    cachedTesseractLang = 'eng';
  }
  return cachedTesseractLang;
}

function isChunkCorruptForRescue(chunk: ReadingChunk): boolean {
  const trimmed = chunk.text.trim();
  if (!trimmed) return true;
  if (isCorruptStrippedGlyphText(trimmed, chunk.type)) return true;
  if (chunk.type === 'heading' && !isValidRomanHeading(trimmed) && !/^\d{1,3}\.?$/.test(trimmed)) {
    const letters = trimmed.match(/\p{L}/gu)?.length ?? 0;
    if (letters > 0 && letters <= 1) return true;
  }
  const nonWs = trimmed.replace(/\s+/g, '').length;
  if (nonWs >= 80 && !assessTextLegibility(trimmed).legible) return true;
  return false;
}

function normalizeLettersOnly(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function firstBaseLetter(text: string): string | null {
  const clean = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const match = clean.match(/[a-z]/);
  return match ? match[0] : null;
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(raw: string): string {
  return decodeHtmlEntities(raw.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const HOCR_PAR_RE = /<p\b[^>]*class=['"][^'"]*\bocr_par\b[^'"]*['"][^>]*>([\s\S]*?)<\/p>/gi;
const HOCR_LINE_RE = /<span\b[^>]*class=['"][^'"]*\bocr_line\b[^'"]*['"][^>]*>([\s\S]*?)(?=<span\b[^>]*class=['"][^'"]*\bocr_line\b|<\/p>|$)/gi;
const HOCR_WORD_RE = /<span\b[^>]*class=['"][^'"]*\bocrx_word\b[^>]*title=['"][^'"]*x_wconf\s+(\d+)[^'"]*['"][^>]*>([\s\S]*?)<\/span>/gi;

function isNoisyLowConfWord(word: string, conf: number): boolean {
  if (conf >= 45) return false;
  if (conf < 35 && /[^a-zA-ZáéíóúüñÁÉÍÓÚÜÑ.,;:!?¿¡—–\-"«»'()]/.test(word)) return true;
  if (conf < 30 && word.length <= 2) return true;
  return false;
}

/**
 * Parses Tesseract `hOCR` HTML into dehyphenated paragraph blocks while dropping
 * low-confidence optical noise (`x_wconf < 55` lines, rubber stamps, shields).
 */
export function parseHocrToBlocks(hocrHtml: string): { text: string; offset: number }[] {
  const blocks: { text: string; offset: number }[] = [];
  let offset = 0;

  for (const parMatch of hocrHtml.matchAll(HOCR_PAR_RE)) {
    const parInner = parMatch[1] ?? '';
    const cleanLines: string[] = [];

    for (const lineMatch of parInner.matchAll(HOCR_LINE_RE)) {
      const lineInner = lineMatch[1] ?? '';
      const words: string[] = [];
      let confSum = 0;
      let confCount = 0;

      for (const wordMatch of lineInner.matchAll(HOCR_WORD_RE)) {
        const conf = Number(wordMatch[1]);
        const wordText = stripTags(wordMatch[2] ?? '');
        if (!wordText) continue;
        if (isNoisyLowConfWord(wordText, conf)) continue;
        words.push(wordText);
        confSum += conf;
        confCount += 1;
      }

      if (words.length === 0) continue;
      const lineText = words.join(' ').replace(/\s+/g, ' ').trim();
      const meanConf = confCount > 0 ? confSum / confCount : 0;
      const minLineConf =
        lineText.length <= 25 && /[^a-zA-ZáéíóúüñÁÉÍÓÚÜÑ\s.,—-]/.test(lineText) ? 62 : 55;
      if (meanConf < minLineConf) continue;
      if (isOcrNoiseArtifact(lineText)) continue;
      cleanLines.push(lineText);
    }

    if (cleanLines.length === 0) continue;
    let parText = cleanLines[0];
    for (let k = 1; k < cleanLines.length; k += 1) {
      parText = dehyphenateLinePair(parText, cleanLines[k]);
    }
    parText = parText.replace(/\s+/g, ' ').trim();
    if (!parText || isOcrNoiseArtifact(parText)) continue;

    const prev = blocks[blocks.length - 1];
    if (
      prev &&
      /[a-záéíóúüñ]{2}-$/.test(prev.text) &&
      /^[a-záéíóúüñ]/.test(parText)
    ) {
      prev.text = dehyphenateLinePair(prev.text, parText);
      offset += parText.length + 2;
      continue;
    }

    blocks.push({ text: parText, offset });
    offset += parText.length + 2;
  }

  return blocks;
}

/**
 * Identifies specific 1-based PDF page numbers that exhibit localized font/ToUnicode
 * glyph loss (such as small-caps stripped to 1-letter initials `D`, `P`, `L . . ,`),
 * single-page mojibake, or degraded legacy OCR layers, capped at `maxPages`.
 */
export function detectPagesNeedingSurgicalOcr(
  doc: BookReadingDocument,
  maxPages: number = MAX_SURGICAL_OCR_PAGES,
): number[] {
  const byPage = new Map<number, ReadingChunk[]>();
  for (const chunk of doc.chunks) {
    const list = byPage.get(chunk.page) ?? [];
    list.push(chunk);
    byPage.set(chunk.page, list);
  }

  const flagged: number[] = [];
  const sortedPages = [...byPage.keys()].sort((a, b) => a - b);

  for (const page of sortedPages) {
    const pageChunks = byPage.get(page) ?? [];
    const hasCorruptChunk = pageChunks.some((c) => isChunkCorruptForRescue(c));
    let pageMojibake = false;
    if (!hasCorruptChunk) {
      const combined = pageChunks.map((c) => c.text).join('\n');
      const verdict = assessTextLegibility(combined);
      pageMojibake = !verdict.empty && !verdict.legible;
    }

    if (hasCorruptChunk || pageMojibake) {
      flagged.push(page);
      if (flagged.length >= maxPages) break;
    }
  }

  return flagged;
}

export async function ocrSinglePdfPage(pdfPath: string, pageNum: number): Promise<string | null> {
  let workDir: string | null = null;
  try {
    workDir = await mkdtemp(join(tmpdir(), 'ignit-page-ocr-'));
    const imgPrefix = join(workDir, 'page');
    await execFileAsync(
      '/usr/bin/pdftoppm',
      ['-png', '-r', '200', '-singlefile', '-f', String(pageNum), '-l', String(pageNum), pdfPath, imgPrefix],
      { timeout: 15_000 },
    );
    const pngPath = `${imgPrefix}.png`;
    await readFile(pngPath);
    const lang = await resolveTesseractLang();
    const { stdout } = await execFileAsync('/usr/bin/tesseract', [pngPath, 'stdout', '-l', lang, 'hocr'], {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 15_000,
    });
    return stdout?.trim() ? stdout : null;
  } catch {
    return null;
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export async function ocrPdfPages(
  pdfPath: string,
  pages: readonly number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const concurrency = 4;
  for (let i = 0; i < pages.length; i += concurrency) {
    const batch = pages.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (page) => ({ page, text: await ocrSinglePdfPage(pdfPath, page) })),
    );
    for (const { page, text } of results) {
      if (text) out.set(page, text);
    }
  }
  return out;
}

/**
 * Surgically merges per-page OCR text into `doc`:
 * - Pages with zero healthy prose chunks are rebuilt cleanly from OCR blocks.
 * - Hybrid pages (where body Unicode prose & inline runs are intact and only
 *   small-caps headings/credits are broken) keep 100% of healthy native chunks
 *   and replace only the corrupt chunks with matching OCR blocks.
 */
export function applySurgicalPageOcr(
  doc: BookReadingDocument,
  ocrByPage: ReadonlyMap<number, string>,
): BookReadingDocument {
  if (ocrByPage.size === 0) return doc;

  const totalPages = Math.max(1, doc.pdfPages);
  const byPage = new Map<number, ReadingChunk[]>();
  for (const chunk of doc.chunks) {
    const list = byPage.get(chunk.page) ?? [];
    list.push(chunk);
    byPage.set(chunk.page, list);
  }

  const nextChunks: ReadingChunk[] = [];
  const seenPages = new Set<number>();

  for (const chunk of doc.chunks) {
    const page = chunk.page;
    if (!ocrByPage.has(page)) {
      nextChunks.push(chunk);
      continue;
    }
    if (seenPages.has(page)) continue;
    seenPages.add(page);

    const pageChunks = byPage.get(page) ?? [];
    const ocrRaw = ocrByPage.get(page) ?? '';
    const isHocr = /<div\s+class=['"]ocr_page['"]|<span\s+class=['"]ocr_line['"]|<p\s+class=['"]ocr_par['"]/i.test(
      ocrRaw,
    );
    const rawOcrBlocks = isHocr
      ? parseHocrToBlocks(ocrRaw)
      : splitPageIntoParagraphs(ocrRaw, { pageNum: page, totalPages });
    const ocrBlocks = rawOcrBlocks.filter(
      (b) => !isExtractionNoiseText(b.text, page, totalPages) && !isOcrNoiseArtifact(b.text),
    );

    const healthyChunks = pageChunks.filter((c) => !isChunkCorruptForRescue(c));

    // Whole-page replacement when no healthy chunks exist on this page
    if (healthyChunks.length === 0) {
      ocrBlocks.forEach((b, idx) => {
        const type = classifyChunkType(b.text, idx);
        const { mood, cues } = classifyMoodAndCues(b.text, nextChunks.length);
        const id = `p${String(page).padStart(4, '0')}.${String(Math.min(9999, b.offset)).padStart(4, '0')}`;
        const built: ReadingChunk = {
          id,
          type,
          page,
          offset: b.offset,
          text: b.text,
          mood,
          cues,
        };
        if (type === 'heading') {
          built.level = inferHeadingLevelFromText(b.text, 16, 14);
        }
        nextChunks.push(built);
      });
      continue;
    }

    // Hybrid page: preserve healthy native Unicode chunks + runs, rescue only corrupt chunks
    const healthyFingerprints = healthyChunks
      .map((c) => normalizeLettersOnly(c.text))
      .filter((fp) => fp.length >= 12);

    const candidateOcrBlocks = ocrBlocks.filter((b) => {
      const fp = normalizeLettersOnly(b.text);
      if (!fp) return false;
      return !healthyFingerprints.some((hfp) => {
        const minLen = Math.min(fp.length, hfp.length);
        const maxLen = Math.max(fp.length, hfp.length);
        if (minLen < maxLen * 0.6) return false;
        const prefixLen = Math.min(24, minLen);
        return hfp.slice(0, prefixLen) === fp.slice(0, prefixLen);
      });
    });

    let cursor = 0;
    for (const c of pageChunks) {
      if (!isChunkCorruptForRescue(c)) {
        nextChunks.push(c);
        continue;
      }

      const targetInitial = firstBaseLetter(c.text);
      let matchedIdx = -1;
      for (let k = cursor; k < candidateOcrBlocks.length; k++) {
        const cand = candidateOcrBlocks[k];
        if (c.type === 'heading' && cand.text.length > 120) continue;
        if (!targetInitial || firstBaseLetter(cand.text) === targetInitial) {
          matchedIdx = k;
          break;
        }
      }

      if (matchedIdx !== -1) {
        const rescuedText = candidateOcrBlocks[matchedIdx].text.replace(/\s+/g, ' ').trim();
        cursor = matchedIdx + 1;
        if (rescuedText && !isExtractionNoiseText(rescuedText, page, totalPages)) {
          const { mood, cues } = classifyMoodAndCues(rescuedText, nextChunks.length);
          const updated: ReadingChunk = {
            ...c,
            text: rescuedText,
            mood,
            cues,
          };
          delete updated.runs;
          nextChunks.push(updated);
        }
      }
      // Unmatched corrupt noise chunk is intentionally dropped
    }
  }

  return {
    ...doc,
    chunks: nextChunks,
  };
}
