import type {
  PdfFontSpec,
  PdfXmlPage,
  PdfXmlSpan,
  ReadingInlineMark,
  ReadingInlineRun,
} from './reading.types.js';

/* ============================================================================
 * Poppler `pdftohtml -xml` typographic & layout extractor
 * ========================================================================== */

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

function parseAttributes(rawAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(rawAttrs)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

function sameMarks(a?: ReadingInlineMark[], b?: ReadingInlineMark[]): boolean {
  const la = a ?? [];
  const lb = b ?? [];
  if (la.length !== lb.length) return false;
  return la.every((m, idx) => m === lb[idx]);
}

export function mergeAdjacentRuns(runs: readonly ReadingInlineRun[]): ReadingInlineRun[] {
  const out: ReadingInlineRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const normalizedMarks =
      run.marks && run.marks.length > 0 ? ([...new Set(run.marks)].sort() as ReadingInlineMark[]) : undefined;
    const last = out[out.length - 1];
    if (last && sameMarks(last.marks, normalizedMarks)) {
      last.text += run.text;
    } else {
      out.push(normalizedMarks ? { text: run.text, marks: normalizedMarks } : { text: run.text });
    }
  }
  return out;
}

export function appendSpaceToRuns(runs: ReadingInlineRun[]): void {
  if (runs.length === 0) return;
  const last = runs[runs.length - 1];
  if (!/\s$/.test(last.text)) {
    last.text += ' ';
  }
}

export function cloneRuns(runs: readonly ReadingInlineRun[]): ReadingInlineRun[] {
  return runs.map((r) => (r.marks ? { text: r.text, marks: [...r.marks] } : { text: r.text }));
}

export function trimRuns(runs: readonly ReadingInlineRun[]): ReadingInlineRun[] {
  const cloned = cloneRuns(runs);
  while (cloned.length > 0) {
    cloned[0].text = cloned[0].text.replace(/^\s+/, '');
    if (cloned[0].text.length === 0) cloned.shift();
    else break;
  }
  while (cloned.length > 0) {
    const last = cloned[cloned.length - 1];
    last.text = last.text.replace(/\s+$/, '');
    if (last.text.length === 0) cloned.pop();
    else break;
  }
  return mergeAdjacentRuns(cloned);
}

export function dehyphenateRuns(
  prevRuns: readonly ReadingInlineRun[],
  nextRuns: readonly ReadingInlineRun[],
): ReadingInlineRun[] {
  const a = trimRuns(prevRuns);
  const b = trimRuns(nextRuns);
  if (a.length === 0) return b;
  if (b.length === 0) return a;

  const prevText = a.map((r) => r.text).join('');
  const nextText = b.map((r) => r.text).join('');

  if (
    /[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]{2}-$/.test(prevText) &&
    /^[a-záéíóúüñ]/.test(nextText)
  ) {
    const last = a[a.length - 1];
    last.text = last.text.slice(0, -1);
    return mergeAdjacentRuns([...a.filter((r) => r.text.length > 0), ...b]);
  }

  appendSpaceToRuns(a);
  return mergeAdjacentRuns([...a, ...b]);
}

function parseInlineXmlRuns(
  innerXml: string,
  baseSpec?: PdfFontSpec,
): ReadingInlineRun[] {
  const strippedLinks = innerXml.replace(/<\/?a\b[^>]*>/gi, '');
  const tokens = strippedLinks.split(/(<\/?(?:b|strong|i|em|code|tt)\b[^>]*>)/gi);
  const baseMarks = new Set<ReadingInlineMark>();
  if (baseSpec?.isBold) baseMarks.add('b');
  if (baseSpec?.isItalic) baseMarks.add('i');
  if (baseSpec?.isMono) baseMarks.add('code');

  let boldDepth = 0;
  let italicDepth = 0;
  let codeDepth = 0;
  const rawRuns: ReadingInlineRun[] = [];

  for (const token of tokens) {
    if (!token) continue;
    const lower = token.toLowerCase();
    if (lower === '<b>' || lower === '<strong>') {
      boldDepth += 1;
      continue;
    }
    if (lower === '</b>' || lower === '</strong>') {
      boldDepth = Math.max(0, boldDepth - 1);
      continue;
    }
    if (lower === '<i>' || lower === '<em>') {
      italicDepth += 1;
      continue;
    }
    if (lower === '</i>' || lower === '</em>') {
      italicDepth = Math.max(0, italicDepth - 1);
      continue;
    }
    if (lower === '<code>' || lower === '<tt>') {
      codeDepth += 1;
      continue;
    }
    if (lower === '</code>' || lower === '</tt>') {
      codeDepth = Math.max(0, codeDepth - 1);
      continue;
    }
    if (/^<[^>]+>$/.test(token)) {
      continue;
    }
    const decoded = decodeXmlEntities(token).replace(/[ \t]+/g, ' ');
    if (!decoded) continue;

    const marks = new Set<ReadingInlineMark>(baseMarks);
    if (boldDepth > 0) marks.add('b');
    if (italicDepth > 0) marks.add('i');
    if (codeDepth > 0) marks.add('code');
    rawRuns.push(
      marks.size > 0
        ? { text: decoded, marks: [...marks].sort() as ReadingInlineMark[] }
        : { text: decoded },
    );
  }

  return mergeAdjacentRuns(rawRuns);
}

export function parsePdftohtmlPages(xml: string): PdfXmlPage[] {
  const fontSpecs = new Map<string, PdfFontSpec>();
  const pages: PdfXmlPage[] = [];

  const pageRe = /<page\b([^>]*)>([\s\S]*?)<\/page>/gi;
  let pageMatch: RegExpExecArray | null;
  while ((pageMatch = pageRe.exec(xml)) !== null) {
    const pageAttrs = parseAttributes(pageMatch[1]);
    const pageBody = pageMatch[2];
    const pageNumber = Number(pageAttrs.number ?? pages.length + 1);
    const width = Number(pageAttrs.width ?? 828) || 828;
    const height = Number(pageAttrs.height ?? 1041) || 1041;

    const fontRe = /<fontspec\b([^>]*)\/?\s*>/gi;
    let fontMatch: RegExpExecArray | null;
    while ((fontMatch = fontRe.exec(pageBody)) !== null) {
      const attrs = parseAttributes(fontMatch[1]);
      if (!attrs.id) continue;
      const family = attrs.family ?? '';
      const size = Number(attrs.size ?? 14) || 14;
      fontSpecs.set(attrs.id, {
        id: attrs.id,
        size,
        family,
        color: attrs.color ?? '#000000',
        isBold: /\b(?:bold|demi|black|heavy|semibold)\b|-bold\b/i.test(family),
        isItalic: /\b(?:italic|oblique|slant)\b|-italic\b/i.test(family),
        isMono:
          /(?:mono|courier|consolas|mcpdigital|typewriter|inconsolata|menlo|fira\s*code|jetbrains|source\s*code|andale|letter\s*gothic|prestige|lucida\s*(?:console|typewriter)|cmtt|lmtt|ectt)/i.test(
            family,
          ),
      });
    }

    const spans: PdfXmlSpan[] = [];
    const textRe = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textRe.exec(pageBody)) !== null) {
      const attrs = parseAttributes(textMatch[1]);
      const top = Number(attrs.top ?? 0);
      const left = Number(attrs.left ?? 0);
      const spanWidth = Number(attrs.width ?? 0);
      const spanHeight = Number(attrs.height ?? 0);
      const fontId = attrs.font ?? '';
      const spec = fontSpecs.get(fontId);

      // Spine / vertical rotated text appears in pdftohtml XML with width="0" and huge height
      if ((spanWidth <= 0 && spanHeight >= 10) || (spanWidth <= 1 && spanHeight >= 40)) continue;
      if (spanHeight <= 0) continue;

      const runs = parseInlineXmlRuns(textMatch[2], spec);
      const rawText = runs.map((r) => r.text).join('');
      if (!rawText.trim()) continue;

      const fontSize = spec?.size ?? Math.max(8, Math.round(spanHeight));
      const allBold = runs.every((r) => !r.text.trim() || r.marks?.includes('b'));
      const allItalic = runs.every((r) => !r.text.trim() || r.marks?.includes('i'));
      const allMono = runs.every((r) => !r.text.trim() || r.marks?.includes('code'));

      spans.push({
        top,
        left,
        width: spanWidth,
        height: spanHeight,
        fontId,
        fontSize,
        runs,
        text: rawText,
        isBold: allBold,
        isItalic: allItalic,
        isMono: allMono,
      });
    }

    pages.push({ number: pageNumber, width, height, spans });
  }

  return pages;
}
