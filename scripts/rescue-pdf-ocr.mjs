#!/usr/bin/env node
/**
 * Local deterministic PDF rescue script for Ignit.
 *
 * Scans a PDF file or directory of PDFs using `pdftotext` plus the backend's
 * own legibility gate (`assessTextLegibility` from
 * `backend/src/books/reading/reading.legibility.ts`, imported directly —
 * Node 24 strips its erasable TypeScript types natively). Any PDF with
 * broken `/ToUnicode` CMaps (mojibake) or scanned-image pages (empty text)
 * is re-OCR'd into a clean, searchable PDF using `ocrmypdf` (preferred) or
 * `pdftoppm` + `tesseract`.
 *
 * Usage:
 *   node scripts/rescue-pdf-ocr.mjs <file-or-dir> [--out-dir <dir>] [--lang spa+eng] [--dry-run]
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { assessTextLegibility } from '../backend/src/books/reading/reading.legibility.ts';

function hasBinary(name) {
  const res = spawnSync('which', [name], { encoding: 'utf8' });
  return res.status === 0;
}

function extractTextWithPdftotext(pdfPath) {
  try {
    return execFileSync('pdftotext', ['-q', pdfPath, '-'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return '';
  }
}

function rescueWithOcrmypdf(inputPath, outputPath, lang) {
  execFileSync(
    'ocrmypdf',
    ['--force-ocr', '--optimize', '1', '-l', lang, inputPath, outputPath],
    { stdio: 'inherit' },
  );
}

function rescueWithPdftoppmAndTesseract(inputPath, outputPath, lang) {
  const workDir = mkdtempSync(join(tmpdir(), 'ignit-ocr-'));
  try {
    const prefix = join(workDir, 'page');
    execFileSync('pdftoppm', ['-png', '-r', '180', inputPath, prefix], { stdio: 'inherit' });
    const pages = readdirSync(workDir)
      .filter((name) => name.endsWith('.png'))
      .sort()
      .map((name) => join(workDir, name));

    if (pages.length === 0) {
      throw new Error('pdftoppm did not produce any page images');
    }

    const listFile = join(workDir, 'pages.txt');
    writeFileSync(listFile, `${pages.join('\n')}\n`, 'utf8');
    const outBase = outputPath.replace(/\.pdf$/i, '');
    execFileSync('tesseract', [listFile, outBase, '-l', lang, 'pdf'], { stdio: 'inherit' });
    if (!existsSync(`${outBase}.pdf`)) {
      // Tesseract drops to plain text and ignores the `pdf` config when its
      // TESSDATA_PREFIX lacks the configs/ directory: fail loudly instead of
      // leaving the caller to "verify" the untouched input file (and possibly
      // overwrite it when input and output share a directory).
      if (existsSync(`${outBase}.txt`)) {
        throw new Error(
          'tesseract produced text output, not a searchable PDF: TESSDATA_PREFIX is missing the tesseract configs/ directory',
        );
      }
      throw new Error('tesseract did not produce the output PDF');
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function collectPdfFiles(target) {
  const full = resolve(target);
  const st = statSync(full);
  if (st.isFile()) return full.toLowerCase().endsWith('.pdf') ? [full] : [];
  const results = [];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    const child = join(full, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectPdfFiles(child));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
      results.push(child);
    }
  }
  return results.sort();
}

function parseArgs(argv) {
  const args = { target: '', outDir: '', lang: 'spa+eng', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--out-dir' && argv[i + 1]) args.outDir = argv[++i];
    else if (a === '--lang' && argv[i + 1]) args.lang = argv[++i];
    else if (!a.startsWith('--') && !args.target) args.target = a;
  }
  return args;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.target || !existsSync(opts.target)) {
  console.error(
    'Usage: node scripts/rescue-pdf-ocr.mjs <file-or-dir> [--out-dir <dir>] [--lang spa+eng] [--dry-run]',
  );
  process.exit(1);
}

if (!hasBinary('pdftotext')) {
  console.error('Error: pdftotext (poppler-utils) is required.');
  process.exit(1);
}

const useOcrmypdf = hasBinary('ocrmypdf');
const useTesseract = hasBinary('pdftoppm') && hasBinary('tesseract');
if (!opts.dryRun && !useOcrmypdf && !useTesseract) {
  console.error('Error: install `ocrmypdf` or (`poppler-utils` + `tesseract-ocr`) to run OCR.');
  process.exit(1);
}

const files = collectPdfFiles(opts.target);
const outDir = opts.outDir ? resolve(opts.outDir) : resolve(process.cwd(), 'rescued-pdfs');
if (!opts.dryRun && !existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

let okCount = 0;
let rescuedCount = 0;
let needsOcrCount = 0;
let skippedCount = 0;

for (const file of files) {
  const verdict = assessTextLegibility(extractTextWithPdftotext(file));
  // The backend gate treats empty text as legible (it lands on `ocrPending`);
  // for rescue purposes an empty extraction IS a scanned page and needs OCR.
  const needsOcr = !verdict.legible || verdict.empty;
  const reason = !verdict.legible ? 'mojibake/broken-ToUnicode' : 'empty/scanned';
  const name = basename(file);

  if (!needsOcr) {
    okCount += 1;
    console.log(
      `[OK] ${name} (alpha=${verdict.alphaRatio.toFixed(2)}, words=${verdict.realWordRatio.toFixed(2)}, replacements=${verdict.replacementRatio.toFixed(3)})`,
    );
    continue;
  }

  needsOcrCount += 1;
  console.log(
    `[NEEDS_OCR:${reason}] ${name} (alpha=${verdict.alphaRatio.toFixed(2)}, words=${verdict.realWordRatio.toFixed(2)}, replacements=${verdict.replacementRatio.toFixed(3)})`,
  );

  if (opts.dryRun) continue;

  const outPath = join(outDir, name);
  if (outPath === resolve(file)) {
    // Never rasterize the input into itself: refuse instead of destroying it.
    console.error(`  -> SKIPPED ${name}: output would overwrite the input PDF (use --out-dir)`);
    skippedCount += 1;
    continue;
  }
  if (useOcrmypdf) {
    rescueWithOcrmypdf(file, outPath, opts.lang);
  } else {
    rescueWithPdftoppmAndTesseract(file, outPath, opts.lang);
  }
  const postVerdict = assessTextLegibility(extractTextWithPdftotext(outPath));
  console.log(
    `  -> Rescued ${outPath} [legible=${postVerdict.legible && !postVerdict.empty}, alpha=${postVerdict.alphaRatio.toFixed(2)}, replacements=${postVerdict.replacementRatio.toFixed(3)}]`,
  );
  rescuedCount += 1;
}

console.log(
  `\nSummary: total=${files.length}, ok=${okCount}, needs_ocr=${needsOcrCount}, rescued=${rescuedCount}, skipped=${skippedCount}`,
);
