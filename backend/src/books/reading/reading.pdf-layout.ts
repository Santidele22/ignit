import type {
  PdfLine,
  PdfLineSegment,
  PdfXmlPage,
  PdfXmlSpan,
  ReadingInlineRun,
} from './reading.types.js';
import { appendSpaceToRuns, cloneRuns, trimRuns } from './reading.pdf-xml.js';

export function assemblePageLines(page: PdfXmlPage, approxBodySize: number): PdfLine[] {
  if (page.spans.length === 0) return [];
  const sorted = [...page.spans].sort((a, b) => a.top - b.top || a.left - b.left);

  // Deduplicate drop-shadow / double-drawn identical text (e.g. cover title rendered twice 1-2px apart)
  const deduped: PdfXmlSpan[] = [];
  for (const span of sorted) {
    const trimmed = span.text.trim();
    const isDuplicate = deduped.some(
      (prev) =>
        Math.abs(prev.top - span.top) <= 5 &&
        Math.abs(prev.left - span.left) <= 8 &&
        prev.text.trim() === trimmed,
    );
    if (!isDuplicate) {
      deduped.push(span);
    }
  }

  const lineGroups: PdfXmlSpan[][] = [];
  for (const span of deduped) {
    const lastGroup = lineGroups[lineGroups.length - 1];
    if (lastGroup) {
      const ref = lastGroup[0];
      const tol = Math.max(3, Math.round(Math.min(ref.height, span.height) * 0.42));
      if (Math.abs(span.top - ref.top) <= tol) {
        lastGroup.push(span);
        continue;
      }
    }
    lineGroups.push([span]);
  }

  const lines: PdfLine[] = [];
  const gapThreshold = Math.max(14, approxBodySize * 1.1);

  for (const group of lineGroups) {
    group.sort((a, b) => a.left - b.left);

    const segments: PdfLineSegment[] = [];
    let currentRuns: ReadingInlineRun[] = [];
    let segLeft = group[0].left;
    let segRight = group[0].left + group[0].width;
    let segFontWeight = 0;
    let segWeightedSize = 0;
    let segBoldChars = 0;
    let segItalicChars = 0;
    let segMonoChars = 0;

    const flushSegment = () => {
      const cleanedRuns = trimRuns(currentRuns);
      const segText = cleanedRuns
        .map((r) => r.text)
        .join('')
        .replace(/[ \t]+/g, ' ')
        .trim();
      if (!segText) return;
      const charCount = Math.max(1, segWeightOrLen(segWeightFallback(segFontWeight, segText)));
      segments.push({
        left: segLeft,
        right: segRight,
        text: segText,
        runs: cleanedRuns,
        fontSize: Math.round(segWeightedSize / charCount),
        isBold: segBoldChars >= segText.length * 0.65,
        isItalic: segItalicChars >= segText.length * 0.65,
        isMono: segMonoChars >= segText.length * 0.65,
      });
    };

    for (let i = 0; i < group.length; i++) {
      const span = group[i];
      const len = Math.max(1, span.text.trim().length);

      if (i === 0) {
        currentRuns = cloneRuns(span.runs);
        segLeft = span.left;
        segRight = span.left + span.width;
        segFontWeight = len;
        segWeightedSize = span.fontSize * len;
        segBoldChars = span.isBold ? len : 0;
        segItalicChars = span.isItalic ? len : 0;
        segMonoChars = span.isMono ? len : 0;
        continue;
      }

      const prev = group[i - 1];
      const prevEnd = prev.left + prev.width;
      const gap = span.left - prevEnd;

      if (gap >= gapThreshold) {
        flushSegment();
        currentRuns = cloneRuns(span.runs);
        segLeft = span.left;
        segRight = span.left + span.width;
        segFontWeight = len;
        segWeightedSize = span.fontSize * len;
        segBoldChars = span.isBold ? len : 0;
        segItalicChars = span.isItalic ? len : 0;
        segMonoChars = span.isMono ? len : 0;
      } else {
        const lastRun = currentRuns[currentRuns.length - 1];
        const firstNext = span.runs[0];
        const needsSpace =
          gap >= Math.max(2, span.fontSize * 0.14) &&
          lastRun &&
          !/\s$/.test(lastRun.text) &&
          firstNext &&
          !/^\s/.test(firstNext.text);
        if (needsSpace) {
          appendSpaceToRuns(currentRuns);
        }
        currentRuns.push(...cloneRuns(span.runs));
        segRight = Math.max(segRight, span.left + span.width);
        segFontWeight += len;
        segWeightedSize += span.fontSize * len;
        if (span.isBold) segBoldChars += len;
        if (span.isItalic) segItalicChars += len;
        if (span.isMono) segMonoChars += len;
      }
    }
    flushSegment();

    if (segments.length === 0) continue;

    const combinedRuns: ReadingInlineRun[] = [];
    let totalChars = 0;
    let totalSizeWeighted = 0;
    let boldChars = 0;
    let italicChars = 0;
    let monoChars = 0;

    segments.forEach((seg, idx) => {
      if (idx > 0) {
        appendSpaceToRuns(combinedRuns);
      }
      combinedRuns.push(...cloneRuns(seg.runs));
      const c = Math.max(1, seg.text.length);
      totalChars += c;
      totalSizeWeighted += seg.fontSize * c;
      if (seg.isBold) boldChars += c;
      if (seg.isItalic) italicChars += c;
      if (seg.isMono) monoChars += c;
    });

    const trimmedRuns = trimRuns(combinedRuns);
    const fullText = trimmedRuns
      .map((r) => r.text)
      .join('')
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (!fullText) continue;

    const lineLeft = segments[0].left;
    const lineRight = segments[segments.length - 1].right;
    const lineWidth = Math.max(0, lineRight - lineLeft);
    const lineCenter = lineLeft + lineWidth / 2;
    const pageCenter = page.width / 2;
    const isCentered =
      lineWidth < page.width * 0.68 &&
      Math.abs(lineCenter - pageCenter) <= page.width * 0.11;

    const minTop = Math.min(...group.map((s) => s.top));
    const maxBottom = Math.max(...group.map((s) => s.top + s.height));

    lines.push({
      top: minTop,
      bottom: maxBottom,
      left: lineLeft,
      right: lineRight,
      text: fullText,
      runs: trimmedRuns,
      segments,
      fontSize: Math.round(totalSizeWeighted / Math.max(1, totalChars)),
      isBold: boldChars >= totalChars * 0.65,
      isItalic: italicChars >= totalChars * 0.65,
      isMono: monoChars >= totalChars * 0.65,
      isCentered,
    });
  }

  return lines;
}

function segWeightFallback(weight: number, text: string): number {
  return weight > 0 ? weight : text.length;
}

function segWeightOrLen(v: number): number {
  return Math.max(1, v);
}

export interface DocumentLayoutStats {
  bodySize: number;
  bodyLineStep: number;
  globalBodyLeft: number;
}

export function computeDocumentStats(pages: readonly PdfXmlPage[]): DocumentLayoutStats {
  const sizeCounts = new Map<number, number>();
  for (const page of pages) {
    for (const span of page.spans) {
      const len = span.text.trim().length;
      if (len < 15) continue;
      sizeCounts.set(span.fontSize, (sizeCounts.get(span.fontSize) ?? 0) + len);
    }
  }
  if (sizeCounts.size === 0) {
    for (const page of pages) {
      for (const span of page.spans) {
        const len = span.text.trim().length;
        sizeCounts.set(span.fontSize, (sizeCounts.get(span.fontSize) ?? 0) + len);
      }
    }
  }

  let bodySize = 14;
  let bestCount = -1;
  for (const [size, count] of sizeCounts.entries()) {
    if (count > bestCount) {
      bestCount = count;
      bodySize = size;
    }
  }

  const lineSteps: number[] = [];
  const leftCounts = new Map<number, number>();
  for (const page of pages) {
    const lines = assemblePageLines(page, bodySize);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.text.length >= 28 && Math.abs(line.fontSize - bodySize) <= 2) {
        const bucket = Math.round(line.left / 4) * 4;
        leftCounts.set(bucket, (leftCounts.get(bucket) ?? 0) + 1);
      }
      if (i > 0) {
        const dy = line.top - lines[i - 1].top;
        if (dy >= bodySize * 0.85 && dy <= bodySize * 2.2) {
          lineSteps.push(dy);
        }
      }
    }
  }

  lineSteps.sort((a, b) => a - b);
  const bodyLineStep =
    lineSteps.length > 0 ? lineSteps[Math.floor(lineSteps.length / 2)] : Math.round(bodySize * 1.35);

  let globalBodyLeft = 107;
  let bestLeftCount = -1;
  for (const [left, count] of leftCounts.entries()) {
    if (count > bestLeftCount) {
      bestLeftCount = count;
      globalBodyLeft = left;
    }
  }

  return { bodySize, bodyLineStep, globalBodyLeft };
}

export function computePageBodyBounds(
  lines: readonly PdfLine[],
  stats: DocumentLayoutStats,
): { bodyLeft: number; bodyRight: number } {
  const leftCounts = new Map<number, number>();
  let maxRight = 0;
  for (const line of lines) {
    if (line.text.length >= 25 && Math.abs(line.fontSize - stats.bodySize) <= 2) {
      const bucket = Math.round(line.left / 3) * 3;
      leftCounts.set(bucket, (leftCounts.get(bucket) ?? 0) + 1);
      if (line.right > maxRight) maxRight = line.right;
    }
  }
  let bodyLeft = stats.globalBodyLeft;
  let best = -1;
  for (const [left, count] of leftCounts.entries()) {
    if (count > best) {
      best = count;
      bodyLeft = left;
    }
  }
  return {
    bodyLeft,
    bodyRight: maxRight > bodyLeft + 200 ? maxRight : bodyLeft + 520,
  };
}
