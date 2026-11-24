import {
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFStream,
  type PDFObject,
  type PDFContext,
} from 'pdf-lib';
import { FORBIDDEN_PDF_NAMES, isForbiddenPdfName, normalizePdfNames } from './pdf-firewall.rules.js';
import type { PdfViolation } from './pdf-firewall.types.js';

/** A PDF needs at least one page; a file without pages is not a readable book. */
export const MIN_FIREWALL_PAGES = 1;

/** Depth guard for the object-graph walk (hostile files can be arbitrarily deep). */
const MAX_TRAVERSAL_DEPTH = 64;

export type PdfStructureScan = {
  pageCount: number;
  violations: PdfViolation[];
};

/**
 * Tier 2 of the PDF firewall: parse the document with `pdf-lib` and inspect the
 * real object graph.
 *
 * Any parse exception is treated as hostile (`PARSE_ERROR`) — `pdf-lib` is
 * permissive enough that a real book parses, so a throw means a broken or
 * crafted file. Encrypted documents are rejected before the walk: their
 * streams cannot be read, so nothing inside them can be verified.
 */
export async function inspectPdfStructure(
  buffer: Buffer,
  maxPages: number,
): Promise<PdfStructureScan> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(buffer, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
  } catch (error) {
    if (error instanceof EncryptedPDFError) {
      return {
        pageCount: 0,
        violations: [{ code: 'ENCRYPTED', detail: '/Encrypt' }],
      };
    }
    return {
      pageCount: 0,
      violations: [{ code: 'PARSE_ERROR', detail: describeError(error) }],
    };
  }

  const violations: PdfViolation[] = [];

  const forbiddenNames = collectForbiddenNames(doc);
  if (forbiddenNames.includes('Encrypt')) {
    // Belt and braces: a trailer `/Encrypt` that the parser tolerated without
    // throwing still means the content could not be inspected.
    violations.push({ code: 'ENCRYPTED', detail: '/Encrypt' });
  }
  for (const name of forbiddenNames) {
    if (name === 'Encrypt') continue;
    violations.push({ code: 'ACTIVE_CONTENT_KEY', detail: `/${name}` });
  }

  let pageCount = 0;
  try {
    pageCount = doc.getPageCount();
  } catch (error) {
    return {
      pageCount: 0,
      violations: [{ code: 'PARSE_ERROR', detail: describeError(error) }],
    };
  }

  if (pageCount < MIN_FIREWALL_PAGES) {
    violations.push({
      code: 'PAGE_COUNT_OUT_OF_BOUNDS',
      detail: `${pageCount} páginas (mínimo ${MIN_FIREWALL_PAGES})`,
    });
  } else if (pageCount > maxPages) {
    violations.push({
      code: 'PAGE_COUNT_OUT_OF_BOUNDS',
      detail: `${pageCount} páginas (máximo ${maxPages})`,
    });
  }

  return { pageCount, violations };
}

/**
 * Walks the catalog plus every indirect object (including the objects `pdf-lib`
 * decompressed out of `/ObjStm`) and returns the forbidden dictionary keys it
 * finds, in a stable order.
 */
function collectForbiddenNames(doc: PDFDocument): string[] {
  const context = doc.context;
  const found = new Set<string>();
  const visited = new Set<PDFObject>();

  const visit = (value: PDFObject | undefined, depth: number): void => {
    if (!value || depth > MAX_TRAVERSAL_DEPTH) {
      return;
    }

    const resolved = context.lookup(value);
    if (!resolved || visited.has(resolved)) {
      return;
    }

    if (resolved instanceof PDFDict) {
      visited.add(resolved);
      for (const [key, entry] of resolved.entries()) {
        for (const part of decodePdfNameParts(key)) {
          if (isForbiddenPdfName(part)) {
            found.add(part);
          }
        }
        visit(entry, depth + 1);
      }
      return;
    }

    if (resolved instanceof PDFName) {
      // Name *values* matter too: `/S /JavaScript` is how an action declares its
      // type, and `/Type /Filespec` marks an attached file. A name that is not a
      // dictionary key is still a forbidden token.
      visited.add(resolved);
      for (const part of decodePdfNameParts(resolved)) {
        if (isForbiddenPdfName(part)) {
          found.add(part);
        }
      }
      return;
    }

    if (resolved instanceof PDFArray) {
      visited.add(resolved);
      for (const entry of resolved.asArray()) {
        visit(entry, depth + 1);
      }
      return;
    }

    if (resolved instanceof PDFStream) {
      visited.add(resolved);
      visit(resolved.dict, depth + 1);
    }
  };

  visit(doc.catalog, 0);
  for (const [, object] of context.enumerateIndirectObjects()) {
    visit(object, 0);
  }

  return FORBIDDEN_PDF_NAMES.filter((name) => found.has(name));
}

/**
 * A dictionary key is a `PDFName`; decoding it here is case-insensitive on
 * `#XX` escapes, unlike `PDFName.decodeText` (which only understands uppercase
 * hex), so `/Ja#76aScript` is caught structurally too.
 */
function decodePdfNameParts(name: PDFName): string[] {
  return normalizePdfNames(name.asString())
    .split('/')
    .filter((part) => part.length > 0);
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'el documento no se pudo analizar';
}
