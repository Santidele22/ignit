import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const require = createRequire(import.meta.url);

function resolveCmapDir(): string | undefined {
  try {
    const pkgPath = require.resolve('pdfjs-dist/package.json');
    const cmapsDir = join(dirname(pkgPath), 'cmaps');
    if (existsSync(cmapsDir)) {
      return cmapsDir.endsWith('/') ? cmapsDir : `${cmapsDir}/`;
    }
  } catch {
    // Optional CMap directory; pdfjs-dist still handles embedded /ToUnicode CMaps without it.
  }
  return undefined;
}

type PositionedItem = {
  str: string;
  x: number;
  y: number;
  hasEol: boolean;
};

function groupTextItemsIntoPageText(items: unknown[]): string {
  const positioned: PositionedItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as { str?: unknown; transform?: unknown; hasEOL?: unknown };
    if (typeof item.str !== 'string') continue;
    const transform = Array.isArray(item.transform) ? item.transform : null;
    const x = transform && typeof transform[4] === 'number' ? transform[4] : 0;
    const y = transform && typeof transform[5] === 'number' ? transform[5] : 0;
    positioned.push({
      str: item.str,
      x,
      y,
      hasEol: item.hasEOL === true,
    });
  }

  if (positioned.length === 0) return '';

  const lines: { y: number; text: string }[] = [];
  let currentY = positioned[0].y;
  let currentParts: string[] = [];

  for (const item of positioned) {
    const dy = Math.abs(item.y - currentY);
    if (dy > 3.5 && currentParts.length > 0) {
      const lineText = currentParts.join(' ').replace(/[ \t]+/g, ' ').trim();
      if (lineText) lines.push({ y: currentY, text: lineText });
      currentParts = [];
      currentY = item.y;
    } else if (currentParts.length === 0) {
      currentY = item.y;
    }
    if (item.str.trim().length > 0) {
      currentParts.push(item.str);
    }
    if (item.hasEol && currentParts.length > 0) {
      const lineText = currentParts.join(' ').replace(/[ \t]+/g, ' ').trim();
      if (lineText) lines.push({ y: currentY, text: lineText });
      currentParts = [];
    }
  }

  if (currentParts.length > 0) {
    const lineText = currentParts.join(' ').replace(/[ \t]+/g, ' ').trim();
    if (lineText) lines.push({ y: currentY, text: lineText });
  }

  if (lines.length === 0) return '';

  const out: string[] = [lines[0].text];
  for (let i = 1; i < lines.length; i += 1) {
    const gap = Math.abs(lines[i - 1].y - lines[i].y);
    out.push(gap > 20 ? `\n\n${lines[i].text}` : `\n${lines[i].text}`);
  }
  return out.join('');
}

/**
 * Extracts per-page text in pure Node.js using `pdfjs-dist`, properly decoding
 * `/ToUnicode` CMaps and custom font encodings even when `poppler-utils` is
 * unavailable (e.g. Render Node runtime).
 */
export async function extractPagesWithPdfJs(buffer: Buffer): Promise<string[] | null> {
  const cMapUrl = resolveCmapDir();
  let loadingTask: ReturnType<typeof getDocument> | null = null;
  let doc: Awaited<ReturnType<typeof getDocument>['promise']> | null = null;

  try {
    loadingTask = getDocument({
      data: new Uint8Array(buffer),
      ...(cMapUrl ? { cMapUrl, cMapPacked: true } : {}),
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0,
    });
    doc = await loadingTask.promise;

    const pages: string[] = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
      const page = await doc.getPage(pageNum);
      try {
        const content = await page.getTextContent();
        pages.push(groupTextItemsIntoPageText(content.items));
      } finally {
        page.cleanup();
      }
    }

    return pages.length > 0 ? pages : null;
  } catch {
    return null;
  } finally {
    await loadingTask?.destroy().catch(() => undefined);
  }
}
