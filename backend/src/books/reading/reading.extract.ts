import { readFile } from 'node:fs/promises';
import type { BookReadingDocument, ReadingChunk } from './reading.types.js';
import { READING_EXTRACTOR_VERSION } from './reading.types.js';
import { classifyMoodAndCues } from './reading.mood.js';
import { cleanPageTextsForExtraction } from './reading.noise.js';
import { classifyChunkType, splitPageIntoParagraphs } from './reading.chunks.js';
import { extractPagesFromPdfBuffer, runPdftohtmlXml, runPdftotext } from './reading.pdf-text.js';
import { extractPagesWithPdfJs } from './reading.pdfjs.js';
import { inferHeadingLevelFromText } from './reading.block-rules.js';
import { extractReadingFromPdftohtmlXml } from './reading.xml-blocks.js';
import { countCorruptShortHeadings, hasPartialFontCorruption } from './reading.legibility.js';
import { normalizeReadingDocument } from './reading.normalizer.js';
import {
  applySurgicalPageOcr,
  detectPagesNeedingSurgicalOcr,
  ocrPdfPages,
} from './reading.ocr-rescue.js';

export async function extractReadingFromPdf(
  bookId: number,
  pdfPath: string,
): Promise<BookReadingDocument> {
  let xmlFallbackDoc: BookReadingDocument | null = null;
  const xml = await runPdftohtmlXml(pdfPath);
  if (xml) {
    const xmlDoc = extractReadingFromPdftohtmlXml(bookId, xml);
    if (!xmlDoc.ocrPending && xmlDoc.chunks.length > 0) {
      const corruptPages = detectPagesNeedingSurgicalOcr(xmlDoc);
      if (corruptPages.length === 0) {
        return normalizeReadingDocument(xmlDoc);
      }
      const ocrMap = await ocrPdfPages(pdfPath, corruptPages);
      const rescuedDoc =
        ocrMap.size > 0 ? applySurgicalPageOcr(xmlDoc, ocrMap) : xmlDoc;
      const normalized = normalizeReadingDocument(rescuedDoc);
      if (!hasPartialFontCorruption(normalized)) {
        return normalized;
      }
      xmlFallbackDoc = normalized;
    }
  }

  let pageTexts = await runPdftotext(pdfPath);
  let totalPages = pageTexts?.length ?? 0;

  if (!pageTexts || pageTexts.every((p) => p.trim().length === 0)) {
    try {
      const buf = await readFile(pdfPath);
      const pdfJsPages = await extractPagesWithPdfJs(buf);
      if (pdfJsPages && pdfJsPages.some((p) => p.trim().length > 0)) {
        pageTexts = pdfJsPages;
        totalPages = Math.max(totalPages, pdfJsPages.length);
      } else {
        const fallback = extractPagesFromPdfBuffer(buf);
        totalPages = Math.max(totalPages, fallback.pageCount);
        if (fallback.pages.some((p) => p.trim().length > 0)) {
          pageTexts = fallback.pages;
        }
      }
    } catch {
      totalPages = Math.max(1, totalPages);
    }
  }

  const chunks: ReadingChunk[] = [];
  if (pageTexts && pageTexts.length > 0) {
    const cleanedPages = cleanPageTextsForExtraction(pageTexts);
    for (let i = 0; i < cleanedPages.length; i++) {
      const pageNum = i + 1;
      const blocks = splitPageIntoParagraphs(cleanedPages[i], {
        pageNum,
        totalPages: cleanedPages.length,
      });
      blocks.forEach((b, idx) => {
        const type = classifyChunkType(b.text, idx);
        const prevChunk = chunks[chunks.length - 1];
        if (type === 'code' && prevChunk && prevChunk.type === 'code' && prevChunk.page === pageNum) {
          prevChunk.text = `${prevChunk.text}\n\n${b.text}`;
          return;
        }
        const { mood, cues } = classifyMoodAndCues(b.text, chunks.length);
        const id = `p${String(pageNum).padStart(4, '0')}.${String(Math.min(9999, b.offset)).padStart(4, '0')}`;
        const chunk: ReadingChunk = {
          id,
          type,
          page: pageNum,
          offset: b.offset,
          text: b.text,
          mood,
          cues,
        };
        if (type === 'heading') {
          chunk.level = inferHeadingLevelFromText(b.text, 16, 14);
        }
        if (type === 'list') {
          chunk.ordered = false;
          chunk.items = b.text
            .split('\n')
            .map((l) => l.replace(/^[•◦▪▫●○*-–]\s*/, '').trim())
            .filter(Boolean);
        }
        chunks.push(chunk);
      });
    }
  }

  const pdfPages = Math.max(1, totalPages, chunks.at(-1)?.page ?? 1);
  const textDoc = normalizeReadingDocument({
    bookId: String(bookId),
    pdfPages,
    ocrPending: chunks.length === 0,
    extractorVersion: READING_EXTRACTOR_VERSION,
    chunks,
  });
  if (
    xmlFallbackDoc &&
    (textDoc.chunks.length === 0 ||
      countCorruptShortHeadings(textDoc) >= countCorruptShortHeadings(xmlFallbackDoc))
  ) {
    return xmlFallbackDoc;
  }
  return textDoc;
}

