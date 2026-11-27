#!/usr/bin/env node
/**
 * Idempotent batch normalizer for local `reading*.json` artifacts whose
 * `extractorVersion` is behind `READING_EXTRACTOR_VERSION`.
 *
 * Usage:
 *   node scripts/reextract-books.mjs           # dry-run (default)
 *   node scripts/reextract-books.mjs --apply   # write normalized JSONs
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { normalizeReadingDocument } from '../backend/dist/books/reading/reading.normalizer.js';
import { READING_EXTRACTOR_VERSION } from '../backend/dist/books/reading/reading.types.js';

const apply = process.argv.includes('--apply');
const root = resolve(process.cwd(), 'backend/uploads/books');

if (!existsSync(root)) {
  console.log(`No books directory at ${root}`);
  process.exit(0);
}

let scanned = 0;
let updated = 0;
let skipped = 0;

for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = join(root, entry.name);
  for (const file of readdirSync(dir)) {
    if (!/^reading(?:\.deterministic)?\.json$/.test(file)) continue;
    const fullPath = join(dir, file);
    scanned += 1;
    const raw = JSON.parse(readFileSync(fullPath, 'utf8'));
    const currentVer = raw.extractorVersion ?? 0;
    if (currentVer >= READING_EXTRACTOR_VERSION) {
      skipped += 1;
      continue;
    }
    const normalized = normalizeReadingDocument(raw);
    updated += 1;
    console.log(
      `${apply ? 'UPDATED' : 'WOULD_UPDATE'} ${entry.name}/${file}: v${currentVer} -> v${normalized.extractorVersion} (chunks ${raw.chunks?.length ?? 0} -> ${normalized.chunks.length})`,
    );
    if (apply) {
      writeFileSync(fullPath, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
    }
  }
}

console.log(
  `Done (${apply ? 'apply' : 'dry-run'}): scanned=${scanned}, ${apply ? 'updated' : 'pending'}=${updated}, upToDate=${skipped}, targetVersion=${READING_EXTRACTOR_VERSION}`,
);
