import type {
  BookReadingDocument,
  PdfLine,
  RawExtractedBlock,
  ReadingChunk,
} from './reading.types.js';
import { READING_EXTRACTOR_VERSION } from './reading.types.js';
import { buildReadingChunks } from './reading.chunks.js';
import {
  BULLET_LIST_RE,
  CAPTION_RE,
  CREDIT_ROLE_RE,
  DASH_LIST_RE,
  ORDERED_LIST_RE,
  SECTION_NUM_L2_RE,
  SECTION_NUM_L3_RE,
  TOC_HEADING_RE,
  type CodeScanState,
  dehyphenateLinePair,
  formatXmlCodeLines,
  isExtractionNoiseText,
  normalizeEdgeKey,
  scoreCodeLine,
  stripInlineArtifacts,
  updateCodeScanState,
} from './reading.noise.js';
import { assemblePageLines, computeDocumentStats, computePageBodyBounds } from './reading.pdf-layout.js';
import { cloneRuns, dehyphenateRuns, mergeAdjacentRuns, parsePdftohtmlPages, trimRuns } from './reading.pdf-xml.js';
import {
  collectRepeatedEdgeKeys,
  collectSuppressedLabelIndices,
  inferHeadingLevelFromText,
  isDedicationLine,
  isEdgeRunningLine,
  isFrontmatterMetaLine,
  isStandaloneChapterNumber,
  mergeCrossPageParagraphs,
  parseXmlTocLine,
} from './reading.block-rules.js';

export function extractReadingFromPdftohtmlXml(
  bookId: number,
  xml: string,
): BookReadingDocument {
  const xmlPages = parsePdftohtmlPages(xml);
  const totalPages = Math.max(1, xmlPages.length);
  if (xmlPages.length === 0) {
    return {
      bookId: String(bookId),
      pdfPages: 1,
      ocrPending: true,
      extractorVersion: READING_EXTRACTOR_VERSION,
      chunks: [],
    };
  }

  const stats = computeDocumentStats(xmlPages);
  const pageLinesList = xmlPages.map((p) => assemblePageLines(p, stats.bodySize));

  // Detect repeated top/bottom band keys across pages
  const repeatedEdgeKeys = collectRepeatedEdgeKeys(
    xmlPages,
    pageLinesList,
    stats.bodySize,
    totalPages,
  );

  const rawBlocks: RawExtractedBlock[] = [];

  for (let pageIdx = 0; pageIdx < xmlPages.length; pageIdx++) {
    const pageMeta = xmlPages[pageIdx];
    const pageNum = pageMeta.number || pageIdx + 1;
    const rawLines = pageLinesList[pageIdx];
    let inFrontmatterCreditSection = false;

    // Filter running headers/footers and extraction noise
    const filteredLines = rawLines.filter((line) => {
      if (isEdgeRunningLine(line, pageMeta.height, stats.bodySize)) return false;
      const inEdgeBand = line.top < pageMeta.height * 0.11 || line.bottom > pageMeta.height * 0.91;
      if (inEdgeBand && line.fontSize <= stats.bodySize * 1.18) {
        const key = normalizeEdgeKey(line.text);
        if (key && repeatedEdgeKeys.has(key)) return false;
      }
      const cleaned = stripInlineArtifacts(line.text);
      if (!cleaned) return false;
      if (isExtractionNoiseText(cleaned, pageNum, totalPages)) return false;
      return true;
    });

    if (filteredLines.length === 0) continue;

    // Suppress scattered diagram micro-labels right above `Figura X-Y.` / `Tabla X-Y.` captions
    const suppressedIndices = collectSuppressedLabelIndices(filteredLines, stats.bodySize);

    const lines = filteredLines.filter((_, idx) => !suppressedIndices.has(idx));
    if (lines.length === 0) continue;

    const { bodyLeft, bodyRight } = computePageBodyBounds(lines, stats);
    const hasTocHeading = lines.some((l) => TOC_HEADING_RE.test(l.text));
    const tocHits = lines.filter((l) => parseXmlTocLine(l, hasTocHeading) !== null).length;
    const isTocPage = tocHits >= 2 || (hasTocHeading && tocHits >= 1);

    let offsetCursor = 0;
    const pushBlock = (block: Omit<RawExtractedBlock, 'offset'>) => {
      const offset = offsetCursor;
      offsetCursor += block.text.length + 2;
      rawBlocks.push({ ...block, offset });
    };

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // 1. TOC sequence on a TOC page or block with >= 2 leader/column TOC entries
      const tocEntry = parseXmlTocLine(line, isTocPage);
      const wrappedTocStart =
        !tocEntry &&
        isTocPage &&
        i + 1 < lines.length &&
        line.text.length <= 95 &&
        !line.text.endsWith('.') &&
        parseXmlTocLine(lines[i + 1], true) !== null;
      if (wrappedTocStart || (tocEntry && (isTocPage || parseXmlTocLine(lines[i + 1] ?? line, false) !== null))) {
        const tocEntries: string[] = [];
        let j = i;
        while (j < lines.length) {
          const cur = lines[j];
          if (TOC_HEADING_RE.test(cur.text)) {
            if (tocEntries.length === 0) {
              pushBlock({
                type: 'heading',
                page: pageNum,
                text: cur.text.replace(/:$/, '').trim(),
                level: 1,
                align: cur.isCentered ? 'center' : 'left',
                endsWithSentencePunct: false,
                startsLowercase: false,
                firstLineIndented: false,
              });
            }
            j += 1;
            continue;
          }
          const parsed = parseXmlTocLine(cur, true);
          if (parsed) {
            tocEntries.push(`${parsed.label}\t${parsed.pageToken}`);
            j += 1;
            continue;
          }
          // Wrapped 2-line TOC entry whose page number is on the next line
          const next = lines[j + 1];
          const nextParsed = next ? parseXmlTocLine(next, true) : null;
          if (nextParsed && cur.text.length <= 90 && !/[.!?]$/.test(cur.text)) {
            tocEntries.push(`${cur.text} ${nextParsed.label}\t${nextParsed.pageToken}`);
            j += 2;
            continue;
          }
          break;
        }
        if (tocEntries.length >= 2 || (isTocPage && tocEntries.length >= 1)) {
          pushBlock({
            type: 'toc',
            page: pageNum,
            text: tocEntries.join('\n'),
            endsWithSentencePunct: false,
            startsLowercase: false,
            firstLineIndented: false,
          });
          i = j;
          continue;
        }
      }

      // 2. Standalone chapter number followed by large heading title (`1` + `INTRODUCCIÓN`)
      if (isStandaloneChapterNumber(line, stats.bodySize) && i + 1 < lines.length) {
        const next = lines[i + 1];
        if (
          next.top - line.bottom <= 180 &&
          (next.fontSize >= stats.bodySize * 1.35 || (next.isCentered && next.fontSize >= stats.bodySize * 1.11)) &&
          !isStandaloneChapterNumber(next, stats.bodySize)
        ) {
          const mergedTitle = `${line.text.trim()} · ${next.text.trim()}`;
          pushBlock({
            type: 'heading',
            page: pageNum,
            text: mergedTitle,
            level: 1,
            align: next.isCentered ? 'center' : 'left',
            endsWithSentencePunct: false,
            startsLowercase: false,
            firstLineIndented: false,
          });
          i += 2;
          continue;
        }
      }

      // 3. Frontmatter metadata / credits / edition / print-run numbers
      if (isFrontmatterMetaLine(line, pageNum, totalPages, stats.bodySize)) {
        if (CREDIT_ROLE_RE.test(line.text)) {
          inFrontmatterCreditSection = true;
        }
        pushBlock({
          type: 'meta',
          page: pageNum,
          text: line.text,
          align: line.isCentered ? 'center' : 'left',
          endsWithSentencePunct: /[.!?]$/.test(line.text),
          startsLowercase: false,
          firstLineIndented: false,
        });
        i += 1;
        continue;
      }

      if (pageNum <= 6 && inFrontmatterCreditSection && line.fontSize <= stats.bodySize * 1.15 && line.text.length <= 95) {
        pushBlock({
          type: 'meta',
          page: pageNum,
          text: line.text,
          align: line.isCentered ? 'center' : 'left',
          endsWithSentencePunct: /[.!?]$/.test(line.text),
          startsLowercase: false,
          firstLineIndented: false,
        });
        i += 1;
        continue;
      }

      // 4. Dedication on early frontmatter pages
      if (isDedicationLine(line, pageNum, stats.bodySize)) {
        const dedLines: PdfLine[] = [line];
        let j = i + 1;
        while (j < lines.length) {
          const next = lines[j];
          const dy = next.top - lines[j - 1].top;
          if (dy <= stats.bodyLineStep * 1.8 && next.text.length <= 90 && (next.isItalic || next.isCentered || next.left - bodyLeft >= 30)) {
            dedLines.push(next);
            j += 1;
          } else {
            break;
          }
        }
        let dedText = dedLines[0].text;
        for (let k = 1; k < dedLines.length; k++) {
          dedText = dehyphenateLinePair(dedText, dedLines[k].text);
        }
        pushBlock({
          type: 'dedication',
          page: pageNum,
          text: dedText,
          align: 'center',
          endsWithSentencePunct: /[.!?]$/.test(dedText),
          startsLowercase: false,
          firstLineIndented: false,
        });
        i = j;
        continue;
      }

      // 5. Figure / Table captions
      if (CAPTION_RE.test(line.text) && line.fontSize <= stats.bodySize * 1.05) {
        const capLines: PdfLine[] = [line];
        let j = i + 1;
        while (
          j < lines.length &&
          lines[j].top - lines[j - 1].top <= stats.bodyLineStep * 1.4 &&
          lines[j].fontSize <= stats.bodySize * 0.98 &&
          !lines[j].isBold
        ) {
          capLines.push(lines[j]);
          j += 1;
        }
        let capText = capLines[0].text;
        for (let k = 1; k < capLines.length; k++) {
          capText = dehyphenateLinePair(capText, capLines[k].text);
        }
        pushBlock({
          type: 'caption',
          page: pageNum,
          text: capText,
          align: 'center',
          endsWithSentencePunct: /[.!?]$/.test(capText),
          startsLowercase: false,
          firstLineIndented: false,
        });
        i = j;
        continue;
      }

      // 6. Bullet / Ordered Lists (never steal code lines such as `* ptr = ...`)
      const bulletMatch = line.text.match(BULLET_LIST_RE) ?? line.text.match(DASH_LIST_RE);
      const orderedMatch = !bulletMatch ? line.text.match(ORDERED_LIST_RE) : null;
      const isListStart =
        !line.isMono &&
        scoreCodeLine(line.text) < 2 &&
        (Boolean(bulletMatch) ||
          Boolean(
            orderedMatch &&
              line.fontSize <= stats.bodySize * 1.05 &&
              !SECTION_NUM_L2_RE.test(line.text) &&
              !SECTION_NUM_L3_RE.test(line.text),
          ));

      if (isListStart) {
        const isOrdered = Boolean(orderedMatch);
        const items: string[] = [];
        let j = i;

        while (j < lines.length) {
          const cur = lines[j];
          const bMatch = cur.text.match(BULLET_LIST_RE) ?? cur.text.match(DASH_LIST_RE);
          const oMatch = !bMatch ? cur.text.match(ORDERED_LIST_RE) : null;

          if (isOrdered ? oMatch : bMatch) {
            let itemText = (isOrdered ? oMatch![4] : bMatch![1]).trim();
            const markerLeft = cur.left;
            j += 1;
            while (j < lines.length) {
              const cont = lines[j];
              const dy = cont.top - lines[j - 1].top;
              if (dy > stats.bodyLineStep * 1.45) break;
              if (BULLET_LIST_RE.test(cont.text) || DASH_LIST_RE.test(cont.text) || ORDERED_LIST_RE.test(cont.text)) {
                break;
              }
              if (cont.left <= markerLeft + 4 && /[.!?]$/.test(itemText)) break;
              itemText = dehyphenateLinePair(itemText, cont.text);
              j += 1;
            }
            items.push(itemText);
            continue;
          }
          break;
        }

        if (items.length >= 1) {
          pushBlock({
            type: 'list',
            page: pageNum,
            text: items.join('\n'),
            ordered: isOrdered,
            items,
            endsWithSentencePunct: true,
            startsLowercase: false,
            firstLineIndented: false,
          });
          i = j;
          continue;
        }
      }

      // 7. Code blocks (monospace runs or syntax-detected code listings, before heading detection)
      const firstCodeScore = scoreCodeLine(line.text);
      if ((line.isMono && line.text.length <= 160) || firstCodeScore >= 2) {
        const codeLines: PdfLine[] = [line];
        const scanState: CodeScanState = { inBlockComment: false, braceDepth: 0 };
        updateCodeScanState(line.text, scanState);
        let monoCount = line.isMono ? 1 : 0;
        let totalScore = firstCodeScore;
        let scoredLineCount = firstCodeScore >= 1 ? 1 : 0;
        let j = i + 1;

        while (j < lines.length) {
          const next = lines[j];
          if (
            CAPTION_RE.test(next.text) ||
            TOC_HEADING_RE.test(next.text) ||
            isFrontmatterMetaLine(next, pageNum, totalPages, stats.bodySize) ||
            isStandaloneChapterNumber(next, stats.bodySize)
          ) {
            break;
          }
          const dy = next.top - lines[j - 1].top;
          if (dy > stats.bodyLineStep * 3.4) break;

          const nextScore = scoreCodeLine(next.text);
          const acrossBlankGap = dy > stats.bodyLineStep * 1.65;
          if (acrossBlankGap) {
            const strongNext =
              (next.isMono && next.text.length <= 160) || nextScore >= 2 || scanState.inBlockComment;
            if (!strongNext) break;
          } else {
            const looksProse =
              !next.isMono &&
              !scanState.inBlockComment &&
              nextScore === 0 &&
              (scanState.braceDepth === 0 ||
                /^[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{2,}\s+[a-záéíóúüñ]+.*[.!?]$/.test(next.text));
            if (looksProse) break;
          }

          codeLines.push(next);
          if (next.isMono) monoCount += 1;
          const effectiveScore = nextScore > 0 ? nextScore : scanState.inBlockComment ? 1 : 0;
          totalScore += effectiveScore;
          if (effectiveScore >= 1) scoredLineCount += 1;
          updateCodeScanState(next.text, scanState);
          j += 1;
        }

        const isAdmittedCode =
          codeLines.length >= 2 &&
          (monoCount >= Math.ceil(codeLines.length * 0.5) ||
            (totalScore >= 3 && scoredLineCount >= 2));

        if (isAdmittedCode) {
          pushBlock({
            type: 'code',
            page: pageNum,
            text: formatXmlCodeLines(codeLines, stats.bodyLineStep, stats.bodySize),
            endsWithSentencePunct: true,
            startsLowercase: false,
            firstLineIndented: false,
          });
          i = j;
          continue;
        }
      }

      // 8. Headings (`level: 1 | 2 | 3`)
      const startsLower = /^[a-záéíóúüñ]/.test(line.text);
      const endsSentence = /[.!?;»"]$/.test(line.text);
      const endsColon = line.text.endsWith(':');
      const isNumberedSection = SECTION_NUM_L2_RE.test(line.text) || SECTION_NUM_L3_RE.test(line.text);
      const isAllCapsSubheading =
        !line.isMono &&
        line.fontSize >= stats.bodySize * 0.98 &&
        line.text.length >= 4 &&
        line.text.length <= 65 &&
        !endsSentence &&
        !endsColon &&
        line.right < bodyRight - 60 &&
        /^[A-ZÁÉÍÓÚÜÑ0-9\s,.'’"¿?¡!\-()]+$/.test(line.text) &&
        /[A-ZÁÉÍÓÚÜÑ]{3,}/.test(line.text) &&
        (line.isCentered ||
          (i + 1 < lines.length &&
            (lines[i + 1].left - bodyLeft >= 14 ||
              lines[i + 1].top - line.top >= stats.bodyLineStep * 1.15)));
      const isLargeOrBoldHeading =
        !startsLower &&
        line.text.length <= 120 &&
        (isNumberedSection ||
          (line.fontSize >= stats.bodySize * 1.11 && !endsColon) ||
          (line.isCentered && line.fontSize >= stats.bodySize * 1.05 && !endsSentence && !endsColon && line.text.length <= 75) ||
          (line.isBold && line.fontSize >= stats.bodySize * 0.9 && !endsSentence && (!endsColon || line.text.length <= 65) && line.text.length <= 90) ||
          isAllCapsSubheading ||
          (TOC_HEADING_RE.test(line.text) && line.fontSize >= stats.bodySize * 0.95));

      if (isLargeOrBoldHeading && !/—/.test(line.text)) {
        const headingLines: PdfLine[] = [line];
        let j = i + 1;
        while (
          j < lines.length &&
          headingLines.length < 2 &&
          lines[j].top - lines[j - 1].top <= line.fontSize * 1.7 &&
          Math.abs(lines[j].fontSize - line.fontSize) <= 2 &&
          lines[j].isBold === line.isBold &&
          !SECTION_NUM_L2_RE.test(lines[j].text) &&
          !SECTION_NUM_L3_RE.test(lines[j].text) &&
          !/[.!?;:»"]$/.test(lines[j - 1].text) &&
          lines[j].text.length <= 75 &&
          !(lines[j].left - bodyLeft >= 14 && !lines[j].isCentered && Math.abs(lines[j].left - line.left) >= 12) &&
          (!isAllCapsSubheading || !/[a-záéíóúüñ]/.test(lines[j].text)) &&
          !isFrontmatterMetaLine(lines[j], pageNum, totalPages, stats.bodySize)
        ) {
          headingLines.push(lines[j]);
          j += 1;
        }
        const mergedText = headingLines.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim();
        const level = inferHeadingLevelFromText(mergedText, line.fontSize, stats.bodySize);
        if (pageNum <= 6 && /^(?:traducci[oó]n|revisi[oó]n\s+t[eé]cnica)\b/i.test(mergedText)) {
          inFrontmatterCreditSection = true;
        } else {
          inFrontmatterCreditSection = false;
        }
        pushBlock({
          type: 'heading',
          page: pageNum,
          text: mergedText,
          level,
          align: line.isCentered ? 'center' : 'left',
          endsWithSentencePunct: false,
          startsLowercase: false,
          firstLineIndented: false,
        });
        i = j;
        continue;
      }

      // (Code blocks already extracted in step 7 before headings)

      // 9. Indented quotes / epigraphs
      const isOrdinalItem = /^\d{1,2}[aªº.)]\s/.test(line.text);
      const isDeeplyIndented =
        !startsLower &&
        !isOrdinalItem &&
        line.left - bodyLeft >= 28 &&
        (!line.isCentered ||
          (line.isItalic && /[.!?»"]$/.test(line.text)) ||
          Boolean(lines[i + 1]?.text.startsWith('—')));
      const nextIsQuoteContinuation = Boolean(
        lines[i + 1] &&
          lines[i + 1].left - bodyLeft >= 28 &&
          !/^\d{1,2}[aªº.)]\s/.test(lines[i + 1].text),
      );
      if (isDeeplyIndented && (line.isItalic || line.left - bodyLeft >= 60 || nextIsQuoteContinuation)) {
        const quoteLines: PdfLine[] = [line];
        let j = i + 1;
        while (j < lines.length) {
          const next = lines[j];
          const dy = next.top - lines[j - 1].top;
          if (dy > stats.bodyLineStep * 1.9) break;
          if (next.left - bodyLeft < 24) break;
          if (next.fontSize > stats.bodySize * 1.11) break;
          quoteLines.push(next);
          j += 1;
        }
        let quoteText = quoteLines[0].text;
        let quoteRuns = cloneRuns(quoteLines[0].runs);
        for (let k = 1; k < quoteLines.length; k++) {
          const prevQ = quoteLines[k - 1];
          const curQ = quoteLines[k];
          if (curQ.text.startsWith('—') || (curQ.left - prevQ.left > 24 && /[.!?]$/.test(prevQ.text))) {
            quoteText = `${quoteText}\n${curQ.text}`;
            quoteRuns = mergeAdjacentRuns([...quoteRuns, { text: '\n' }, ...curQ.runs]);
          } else {
            quoteText = dehyphenateLinePair(quoteText, curQ.text);
            quoteRuns = dehyphenateRuns(quoteRuns, curQ.runs);
          }
        }
        pushBlock({
          type: 'quote',
          page: pageNum,
          text: quoteText,
          runs: quoteRuns,
          endsWithSentencePunct: /[.!?»"]$/.test(quoteText),
          startsLowercase: /^[a-záéíóúüñ]/.test(quoteText),
          firstLineIndented: false,
        });
        i = j;
        continue;
      }

      // 10. Ordinary prose paragraph (grouped by indent, vertical gap, or short ended line)
      const paraLines: PdfLine[] = [line];
      let j = i + 1;
      while (j < lines.length) {
        const prevL = lines[j - 1];
        const nextL = lines[j];
        const dy = nextL.top - prevL.top;
        if (dy > stats.bodyLineStep * 1.45) break;
        if (nextL.fontSize >= stats.bodySize * 1.11 || nextL.isBold) {
          if (
            nextL.fontSize >= stats.bodySize * 1.11 ||
            SECTION_NUM_L2_RE.test(nextL.text) ||
            SECTION_NUM_L3_RE.test(nextL.text) ||
            (nextL.isBold && nextL.text.length <= 90 && !/[.!?]$/.test(nextL.text))
          ) {
            break;
          }
        }
        if (
          BULLET_LIST_RE.test(nextL.text) ||
          DASH_LIST_RE.test(nextL.text) ||
          CAPTION_RE.test(nextL.text) ||
          isFrontmatterMetaLine(nextL, pageNum, totalPages, stats.bodySize)
        ) {
          break;
        }
        const prevEndedHyphen = /[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]{2}-$/.test(prevL.text);
        const nextStartsLower = /^[a-záéíóúüñ]/.test(nextL.text);
        const nextIndented = nextL.left - bodyLeft >= 14 && !nextL.isCentered;
        if (nextIndented && !prevEndedHyphen && !nextStartsLower) break;
        const prevEndedShort =
          prevL.right < bodyRight - 55 && /[.!?…»":)]$/.test(prevL.text);
        if (prevEndedShort && !nextStartsLower) break;

        paraLines.push(nextL);
        j += 1;
      }

      let paraText = paraLines[0].text;
      let paraRuns = cloneRuns(paraLines[0].runs);
      for (let k = 1; k < paraLines.length; k++) {
        paraText = dehyphenateLinePair(paraText, paraLines[k].text);
        paraRuns = dehyphenateRuns(paraRuns, paraLines[k].runs);
      }
      const cleanedPara = stripInlineArtifacts(paraText.replace(/[ \t]+/g, ' ').trim());
      if (cleanedPara.length >= 2 && !isExtractionNoiseText(cleanedPara, pageNum, totalPages)) {
        const finalRuns =
          cleanedPara === paraText.replace(/[ \t]+/g, ' ').trim()
            ? trimRuns(paraRuns)
            : undefined;
        pushBlock({
          type: 'para',
          page: pageNum,
          text: cleanedPara,
          runs: finalRuns && finalRuns.some((r) => r.marks && r.marks.length > 0) ? finalRuns : undefined,
          endsWithSentencePunct: /[.!?…»":)]$/.test(cleanedPara),
          startsLowercase: /^[a-záéíóúüñ]/.test(cleanedPara),
          firstLineIndented: line.left - bodyLeft >= 14,
        });
      }
      i = j;
    }
  }

  // Merge paragraphs split across page boundaries
  const mergedBlocks = mergeCrossPageParagraphs(rawBlocks);

  const chunks: ReadingChunk[] = buildReadingChunks(mergedBlocks);

  const pdfPages = Math.max(totalPages, chunks.at(-1)?.page ?? 1);
  return {
    bookId: String(bookId),
    pdfPages,
    ocrPending: chunks.length === 0,
    extractorVersion: READING_EXTRACTOR_VERSION,
    chunks,
  };
}
