import type { RawExtractedBlock, ReadingChunk, ReadingChunkType } from './reading.types.js';
import { classifyMoodAndCues } from './reading.mood.js';
import {
  BULLET_LIST_RE,
  CAPTION_RE,
  CHAPTER_HEADING_RE,
  CREDIT_ROLE_RE,
  DASH_LIST_RE,
  EDITION_LINE_RE,
  PRINT_RUN_RE,
  SECTION_NUM_L2_RE,
  SECTION_NUM_L3_RE,
  TOC_HEADING_RE,
  TOC_LINE_RE,
  dedentRawCodeLines,
  dehyphenateLinePair,
  isExtractionNoiseText,
  isRawCodeBlock,
  stripInlineArtifacts,
} from './reading.noise.js';

export function classifyChunkType(paragraph: string, indexInPage: number): ReadingChunkType {
  const trimmed = paragraph.trim();
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.filter((l) => TOC_LINE_RE.test(l)).length >= 2) {
    return 'toc';
  }
  if (CAPTION_RE.test(trimmed) && lines.length <= 2 && trimmed.length <= 200) {
    return 'caption';
  }
  if (lines.length >= 2 && isRawCodeBlock(lines)) {
    return 'code';
  }
  if (lines.length >= 1 && lines.every((l) => BULLET_LIST_RE.test(l) || DASH_LIST_RE.test(l))) {
    return 'list';
  }
  if (
    PRINT_RUN_RE.test(trimmed) ||
    EDITION_LINE_RE.test(trimmed) ||
    CREDIT_ROLE_RE.test(trimmed)
  ) {
    return 'meta';
  }
  const startsLowercase = /^[a-záéíóúüñ]/.test(trimmed);
  const endsSentence = /[.!?;:»"]$/.test(trimmed);
  const hasDialogueDash = /—/.test(trimmed);
  if (
    lines.length === 1 &&
    trimmed.length <= 105 &&
    !startsLowercase &&
    !hasDialogueDash &&
    (SECTION_NUM_L3_RE.test(trimmed) ||
      SECTION_NUM_L2_RE.test(trimmed) ||
      CHAPTER_HEADING_RE.test(trimmed) ||
      (!endsSentence && (indexInPage === 0 || !/[.!?;:»"]$/.test(trimmed))))
  ) {
    return 'heading';
  }
  if (lines.length >= 3 && lines.every((l) => l.length < 65)) {
    return 'verse';
  }
  return 'para';
}

export function splitPageIntoParagraphs(
  pageText: string,
  options?: { pageNum?: number; totalPages?: number },
): Array<{ text: string; offset: number }> {
  const normalized = pageText.replace(/\r\n/g, '\n');
  const rawBlocks = normalized.split(/\n\s*\n+/);
  const results: Array<{ text: string; offset: number }> = [];
  let cursor = 0;

  for (const raw of rawBlocks) {
    const idx = normalized.indexOf(raw, cursor);
    const offset = idx >= 0 ? idx : cursor;
    cursor = offset + raw.length;

    const rawNonEmptyLines = raw
      .split('\n')
      .map((line) => line.replace(/\s+$/, ''))
      .filter(
        (line) =>
          line.trim().length > 0 &&
          !isExtractionNoiseText(line.trim(), options?.pageNum, options?.totalPages),
      );

    if (rawNonEmptyLines.length === 0) continue;

    if (rawNonEmptyLines.length >= 2 && isRawCodeBlock(rawNonEmptyLines)) {
      results.push({ text: dedentRawCodeLines(rawNonEmptyLines).join('\n'), offset });
      continue;
    }

    const lines = rawNonEmptyLines.map((line) => line.replace(/\s+/g, ' ').trim());

    const tocLineCount = lines.filter((line) => TOC_LINE_RE.test(line)).length;
    if (tocLineCount >= 2) {
      let startIdx = 0;
      let tocOffset = offset;
      if (TOC_HEADING_RE.test(lines[0])) {
        results.push({ text: lines[0], offset });
        tocOffset = offset + lines[0].length + 1;
        startIdx = 1;
      }
      const entries: string[] = [];
      let pending = '';
      for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i];
        pending = pending ? `${pending} ${line}` : line;
        if (TOC_LINE_RE.test(pending)) {
          entries.push(pending);
          pending = '';
        }
      }
      if (pending) {
        entries.push(pending);
      }
      if (entries.length > 0) {
        results.push({ text: entries.join('\n'), offset: tocOffset });
      }
      continue;
    }

    if (lines.length >= 2 && lines.every((l) => BULLET_LIST_RE.test(l) || DASH_LIST_RE.test(l))) {
      results.push({ text: lines.join('\n'), offset });
      continue;
    }

    let joined = lines[0];
    for (let i = 1; i < lines.length; i++) {
      joined = dehyphenateLinePair(joined, lines[i]);
    }
    const cleaned = stripInlineArtifacts(joined.replace(/\s+/g, ' ').trim());
    if (cleaned.length < 3) continue;
    if (isExtractionNoiseText(cleaned, options?.pageNum, options?.totalPages)) continue;
    results.push({ text: cleaned, offset });
  }

  return results;
}

export function buildReadingChunks(blocks: readonly RawExtractedBlock[]): ReadingChunk[] {
  return blocks.map((block, idx) => {
    const { mood, cues } = classifyMoodAndCues(block.text, idx);
    const id = `p${String(block.page).padStart(4, '0')}.${String(Math.min(9999, block.offset)).padStart(4, '0')}`;
    const chunk: ReadingChunk = {
      id,
      type: block.type,
      page: block.page,
      offset: block.offset,
      text: block.text,
      mood,
      cues,
    };
    if (block.level !== undefined) chunk.level = block.level;
    if (block.runs !== undefined) chunk.runs = block.runs;
    if (block.ordered !== undefined) chunk.ordered = block.ordered;
    if (block.items !== undefined) chunk.items = block.items;
    if (block.align && block.align !== 'left') chunk.align = block.align;
    return chunk;
  });
}
