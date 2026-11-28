import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inflateSync } from 'node:zlib';

const execFileAsync = promisify(execFile);

function decodePdfLiteralString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = raw[++i];
    if (next === undefined) break;
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === 't') out += '\t';
    else if (next === 'b') out += '\b';
    else if (next === 'f') out += '\f';
    else if (next >= '0' && next <= '7') {
      let oct = next;
      if (raw[i + 1] >= '0' && raw[i + 1] <= '7') oct += raw[++i];
      if (raw[i + 1] >= '0' && raw[i + 1] <= '7') oct += raw[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else {
      out += next;
    }
  }
  return out;
}

function extractTextFromPdfStreamContent(content: string): string {
  const lines: string[] = [];
  const btBlocks = content.match(/BT[\s\S]*?ET/g) ?? [content];
  for (const block of btBlocks) {
    const parts: string[] = [];
    const regex = /\((?:\\.|[^\\()])*\)\s*Tj|\[((?:\\.|[^\]])*)\]\s*TJ/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(block)) !== null) {
      if (m[1] !== undefined) {
        const inner = m[1];
        const strRegex = /\((?:\\.|[^\\()])*\)/g;
        let sm: RegExpExecArray | null;
        let linePart = '';
        while ((sm = strRegex.exec(inner)) !== null) {
          linePart += decodePdfLiteralString(sm[0].slice(1, -1));
        }
        if (linePart.trim()) parts.push(linePart.trim());
      } else {
        const literal = m[0].replace(/\)\s*Tj$/, '').slice(1);
        const decoded = decodePdfLiteralString(literal).trim();
        if (decoded) parts.push(decoded);
      }
    }
    if (parts.length > 0) {
      lines.push(parts.join(' '));
    }
  }
  return lines.join('\n\n');
}

export function extractPagesFromPdfBuffer(buffer: Buffer): {
  pageCount: number;
  pages: string[];
} {
  const latin1 = buffer.toString('latin1');
  const pageMatches = latin1.match(/\/Type\s*\/Page\b(?!s)/g);
  const declaredCountMatch = latin1.match(/\/Count\s+(\d+)/);
  const estimatedPages = Math.max(
    1,
    pageMatches?.length ?? (declaredCountMatch ? Number(declaredCountMatch[1]) : 1),
  );

  const pages: string[] = [];
  const streamRegex = /<<([\s\S]*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRegex.exec(latin1)) !== null) {
    const dict = match[1];
    const rawBody = match[2];
    let decodedContent = rawBody;
    if (/\/FlateDecode\b/.test(dict)) {
      try {
        decodedContent = inflateSync(Buffer.from(rawBody, 'latin1')).toString('latin1');
      } catch {
        continue;
      }
    }
    if (/\bBT\b/.test(decodedContent) && /\b(?:Tj|TJ)\b/.test(decodedContent)) {
      const text = extractTextFromPdfStreamContent(decodedContent).trim();
      if (text) {
        pages.push(text);
      }
    }
  }

  return {
    pageCount: Math.max(estimatedPages, pages.length),
    pages,
  };
}

export async function runPdftohtmlXml(pdfPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      '/usr/bin/pdftohtml',
      ['-xml', '-stdout', '-i', pdfPath],
      {
        maxBuffer: 64 * 1024 * 1024,
        timeout: 30_000,
      },
    );
    if (!stdout || !stdout.includes('<page ')) {
      return null;
    }
    // Scanned OCR PDFs (e.g. Tesseract `GlyphLessFont` in `3 Tr` hidden text mode)
    // emit `<page>` + `<fontspec>` with zero visible `<text>` spans unless `-hidden` is set.
    // Only retry with `-hidden` when the visible layer has zero `<text>` elements across the PDF.
    if (!stdout.includes('<text ')) {
      const hiddenRes = await execFileAsync(
        '/usr/bin/pdftohtml',
        ['-xml', '-hidden', '-stdout', '-i', pdfPath],
        {
          maxBuffer: 64 * 1024 * 1024,
          timeout: 30_000,
        },
      );
      if (hiddenRes.stdout && hiddenRes.stdout.includes('<text ')) {
        return hiddenRes.stdout;
      }
    }
    return stdout;
  } catch {
    return null;
  }
}

export async function runPdftotext(pdfPath: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/pdftotext', ['-q', pdfPath, '-'], {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 20_000,
    });
    if (!stdout || !stdout.trim()) {
      return null;
    }
    // pdftotext appends a trailing form-feed after the last page
    const rawPages = stdout.split('\f');
    if (rawPages.length > 1 && rawPages[rawPages.length - 1].trim() === '') {
      rawPages.pop();
    }
    return rawPages;
  } catch {
    return null;
  }
}
