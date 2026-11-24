import {
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFInvalidObject,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFStream,
  PDFString,
  type PDFContext,
  type PDFObject,
} from 'pdf-lib';
import {
  FORBIDDEN_PDF_NAMES,
  inspectMetadataText,
  inspectPdfUri,
  isEncryptionPdfName,
  isForbiddenPdfName,
  normalizePdfNames,
} from './pdf-firewall.rules.js';
import {
  canonicalPdfName,
  decodeBoundedStream,
  inspectPagesForHiddenContent,
  inspectPdfStreamResources,
  inspectRawPreParseBounds,
  lookupDictEntry,
  type StreamFirewallLimits,
} from './pdf-firewall.streams.js';
import type { PdfViolation } from './pdf-firewall.types.js';

/** A PDF needs at least one page; a file without pages is not a readable book. */
export const MIN_FIREWALL_PAGES = 1;

/** Default upper bound for indirect objects (`MAX_FIREWALL_OBJECTS`). */
export const DEFAULT_MAX_FIREWALL_OBJECTS = 100_000;

/** Depth guard for the object-graph walk; exceeding it is rejected as hostile. */
const MAX_TRAVERSAL_DEPTH = 64;

/** Maximum size for a single `/Info` string field (`16 KB`). */
const MAX_INFO_FIELD_CHARS = 16_384;

/** Maximum size for an XMP `/Metadata` stream (`1 MB`). */
const MAX_XMP_METADATA_CHARS = 1024 * 1024;

export type PdfStructureLimits = StreamFirewallLimits & {
  maxPages: number;
  maxObjects: number;
};

export type PdfStructureScan = {
  pageCount: number;
  violations: PdfViolation[];
};

/**
 * Tier 2 of the PDF firewall: pre-parse stream/object bounds, `pdf-lib` load
 * with strict object parsing, DAG-safe page counting, object-graph walk, stream
 * filter bounds, URI/metadata sanitization and hidden-content inspection.
 */
export async function inspectPdfStructure(
  buffer: Buffer,
  limits: PdfStructureLimits,
): Promise<PdfStructureScan> {
  const preParseViolations = inspectRawPreParseBounds(buffer, limits);
  if (preParseViolations.length > 0) {
    return { pageCount: 0, violations: preParseViolations };
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(buffer, {
      ignoreEncryption: false,
      updateMetadata: false,
      throwOnInvalidObject: true,
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

  try {
    if (!(doc.catalog instanceof PDFDict)) {
      return {
        pageCount: 0,
        violations: [{ code: 'PARSE_ERROR', detail: 'catálogo PDF ausente o inválido' }],
      };
    }

    const indirectObjects = doc.context.enumerateIndirectObjects();
    if (indirectObjects.length > limits.maxObjects) {
      return {
        pageCount: 0,
        violations: [
          {
            code: 'RESOURCE_LIMIT_EXCEEDED',
            detail: `${indirectObjects.length} objetos indirectos (máximo ${limits.maxObjects})`,
          },
        ],
      };
    }

    const violations: PdfViolation[] = [];
    violations.push(...scanObjectGraph(doc, indirectObjects, limits));
    violations.push(...inspectTrailerInfoMetadata(doc));

    // Validate the `/Pages` tree with a visited set *before* calling `pdf-lib`'s
    // `getPageCount()` / `getPages()` (`PDFPageTree.traverse` has no visited set
    // and would hang in O(2^N) on a shared-node `/Kids` DAG).
    const pageTreeCheck = countPageTreeSafely(doc, limits.maxPages);
    if (pageTreeCheck.violation) {
      violations.push(pageTreeCheck.violation);
      return { pageCount: pageTreeCheck.pageCount, violations: deduplicateViolations(violations) };
    }

    const pageCount = pageTreeCheck.pageCount;
    if (pageCount < MIN_FIREWALL_PAGES) {
      violations.push({
        code: 'PAGE_COUNT_OUT_OF_BOUNDS',
        detail: `${pageCount} páginas (mínimo ${MIN_FIREWALL_PAGES})`,
      });
    } else if (pageCount > limits.maxPages) {
      violations.push({
        code: 'PAGE_COUNT_OUT_OF_BOUNDS',
        detail: `${pageCount} páginas (máximo ${limits.maxPages})`,
      });
    }

    if (violations.length === 0) {
      violations.push(...inspectPagesForHiddenContent(doc, limits.maxStreamBytes));
    }

    return { pageCount, violations: deduplicateViolations(violations) };
  } catch (error) {
    return {
      pageCount: 0,
      violations: [{ code: 'PARSE_ERROR', detail: describeError(error) }],
    };
  }
}

function countPageTreeSafely(
  doc: PDFDocument,
  maxPages: number,
): { pageCount: number; violation?: PdfViolation } {
  const context = doc.context;
  const pagesRoot = lookupDictEntry(doc.catalog, 'Pages', context);
  if (!(pagesRoot instanceof PDFDict)) {
    return {
      pageCount: 0,
      violation: { code: 'PARSE_ERROR', detail: 'árbol /Pages ausente o inválido' },
    };
  }

  const visitedNodes = new Set<PDFObject>();
  let pageCount = 0;

  const walk = (node: PDFObject | undefined, depth: number): PdfViolation | null => {
    if (depth > MAX_TRAVERSAL_DEPTH) {
      return {
        code: 'RESOURCE_LIMIT_EXCEEDED',
        detail: `profundidad de /Pages excede ${MAX_TRAVERSAL_DEPTH}`,
      };
    }
    const resolved = context.lookup(node);
    if (!(resolved instanceof PDFDict)) {
      return { code: 'PARSE_ERROR', detail: 'nodo /Pages inválido' };
    }
    if (visitedNodes.has(resolved)) {
      return {
        code: 'PARSE_ERROR',
        detail: 'referencia compartida o cíclica en /Pages (DAG)',
      };
    }
    visitedNodes.add(resolved);

    const typeObj = lookupDictEntry(resolved, 'Type', context);
    const typeName = typeObj instanceof PDFName ? canonicalPdfName(typeObj) : '';
    const kids = lookupDictEntry(resolved, 'Kids', context);

    if (typeName === 'Page' && !kids) {
      pageCount += 1;
      return null;
    }
    if (!(kids instanceof PDFArray)) {
      if (typeName === 'Page') {
        pageCount += 1;
        return null;
      }
      return { code: 'PARSE_ERROR', detail: 'nodo /Pages sin arreglo /Kids' };
    }

    for (const child of kids.asArray()) {
      const err = walk(child, depth + 1);
      if (err) return err;
      if (pageCount > maxPages) {
        return {
          code: 'PAGE_COUNT_OUT_OF_BOUNDS',
          detail: `${countDeclaredOrMeasuredPages(pagesRoot, context, pageCount)} páginas (máximo ${maxPages})`,
        };
      }
    }
    return null;
  };

  const err = walk(pagesRoot, 0);
  if (err) {
    const reportedCount =
      err.code === 'PAGE_COUNT_OUT_OF_BOUNDS'
        ? countDeclaredOrMeasuredPages(pagesRoot, context, pageCount)
        : 0;
    return { pageCount: reportedCount, violation: err };
  }
  return { pageCount };
}

function countDeclaredOrMeasuredPages(
  pagesRoot: PDFDict,
  context: PDFContext,
  measured: number,
): number {
  const countObj = lookupDictEntry(pagesRoot, 'Count', context);
  const asNum = countObj instanceof PDFNumber ? countObj.asNumber() : Number.NaN;
  return Number.isInteger(asNum) && asNum >= measured ? asNum : measured;
}

function scanObjectGraph(
  doc: PDFDocument,
  indirectObjects: Array<[unknown, PDFObject]>,
  limits: PdfStructureLimits,
): PdfViolation[] {
  const context = doc.context;
  const foundForbidden = new Set<string>();
  const contextualViolations: PdfViolation[] = [];
  const visited = new Set<PDFObject>();
  const streamTotals = { decompressedBytes: 0 };
  let depthExceeded = false;
  let invalidObjectSeen = false;

  const visit = (value: PDFObject | undefined, depth: number): void => {
    if (!value) {
      return;
    }
    if (depth > MAX_TRAVERSAL_DEPTH) {
      depthExceeded = true;
      return;
    }

    const resolved = context.lookup(value);
    if (!resolved || visited.has(resolved)) {
      return;
    }

    if (resolved instanceof PDFInvalidObject) {
      visited.add(resolved);
      invalidObjectSeen = true;
      return;
    }

    if (resolved instanceof PDFDict) {
      visited.add(resolved);
      inspectContextualDictionary(resolved, context, limits.maxStreamBytes, contextualViolations);

      for (const [key, entry] of resolved.entries()) {
        for (const part of decodePdfNameParts(key)) {
          if (isForbiddenPdfName(part)) {
            foundForbidden.add(part);
          }
        }
        visit(entry, depth + 1);
      }
      return;
    }

    if (resolved instanceof PDFName) {
      visited.add(resolved);
      for (const part of decodePdfNameParts(resolved)) {
        if (isForbiddenPdfName(part)) {
          foundForbidden.add(part);
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
      contextualViolations.push(
        ...inspectPdfStreamResources(resolved, context, limits, streamTotals),
      );
      visit(resolved.dict, depth + 1);
    }
  };

  visit(doc.catalog, 0);
  for (const [, object] of indirectObjects) {
    visit(object, 0);
  }

  const violations: PdfViolation[] = [];
  if (invalidObjectSeen) {
    violations.push({ code: 'PARSE_ERROR', detail: 'objeto PDF inválido o malformado' });
  }
  if (depthExceeded) {
    violations.push({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      detail: `profundidad de objetos excede ${MAX_TRAVERSAL_DEPTH}`,
    });
  }

  for (const name of FORBIDDEN_PDF_NAMES) {
    if (!foundForbidden.has(name)) continue;
    if (isEncryptionPdfName(name)) {
      violations.push({ code: 'ENCRYPTED', detail: `/${name}` });
    } else {
      violations.push({ code: 'ACTIVE_CONTENT_KEY', detail: `/${name}` });
    }
  }

  violations.push(...contextualViolations);
  return violations;
}

/**
 * Checks dictionary constructs whose safety depends on context (using canonical
 * `#XX`-decoded key/value comparison so lowercase hex escapes never slip past):
 * - `/Subtype /Screen` multimedia annotations (unlike `/BM /Screen` blend mode);
 * - `/S /Hide` phishing overlay actions;
 * - `/AcroForm` dictionaries that carry interactive `/Fields`;
 * - `/URI` strings and catalog `/URI << /Base (...) >>` targets;
 * - `/Metadata` XMP streams attached to the catalog, pages or XObjects.
 */
function inspectContextualDictionary(
  dict: PDFDict,
  context: PDFContext,
  maxStreamBytes: number,
  violations: PdfViolation[],
): void {
  const subtype = lookupDictEntry(dict, 'Subtype', context);
  if (subtype instanceof PDFName && canonicalPdfName(subtype) === 'Screen') {
    violations.push({ code: 'ACTIVE_CONTENT_KEY', detail: '/Screen' });
  }

  const actionType = lookupDictEntry(dict, 'S', context);
  if (actionType instanceof PDFName && canonicalPdfName(actionType) === 'Hide') {
    violations.push({ code: 'ACTIVE_CONTENT_KEY', detail: '/Hide' });
  }

  const acroForm = lookupDictEntry(dict, 'AcroForm', context);
  if (acroForm instanceof PDFDict && hasInteractiveAcroFormFields(acroForm, context)) {
    violations.push({ code: 'ACTIVE_CONTENT_KEY', detail: '/AcroForm' });
  }

  const metadata = lookupDictEntry(dict, 'Metadata', context);
  if (metadata instanceof PDFRawStream) {
    const cap = Math.min(maxStreamBytes, MAX_XMP_METADATA_CHARS + 1);
    const decoded = decodeBoundedStream(metadata, context, cap);
    if (decoded.kind === 'too_large') {
      violations.push({
        code: 'SUSPICIOUS_METADATA',
        detail: `metadatos exceden el límite (${MAX_XMP_METADATA_CHARS} caracteres)`,
      });
    } else if (decoded.kind === 'ok') {
      const xmp = decoded.bytes.toString('utf8');
      const reason = inspectMetadataText(xmp, MAX_XMP_METADATA_CHARS);
      if (reason) {
        violations.push({ code: 'SUSPICIOUS_METADATA', detail: reason });
      }
    }
  }

  for (const [rawKey, rawVal] of dict.entries()) {
    const keyParts = decodePdfNameParts(rawKey);
    if (!keyParts.includes('URI')) continue;

    const resolvedUri = context.lookup(rawVal);
    const uriText = decodePdfStringObject(resolvedUri);
    if (uriText !== null) {
      const reason = inspectPdfUri(uriText);
      if (reason) {
        violations.push({ code: 'SUSPICIOUS_URI', detail: reason });
      }
    } else if (resolvedUri instanceof PDFDict) {
      const baseText = decodePdfStringObject(lookupDictEntry(resolvedUri, 'Base', context));
      if (baseText !== null) {
        const reason = inspectPdfUri(baseText);
        if (reason) {
          violations.push({ code: 'SUSPICIOUS_URI', detail: reason });
        }
      }
    }
  }
}

function hasInteractiveAcroFormFields(acroForm: PDFDict, context: PDFContext): boolean {
  const fields = lookupDictEntry(acroForm, 'Fields', context);
  if (fields instanceof PDFArray) {
    return fields.size() > 0;
  }
  return fields !== undefined;
}

function inspectTrailerInfoMetadata(doc: PDFDocument): PdfViolation[] {
  const context = doc.context;
  const violations: PdfViolation[] = [];

  const infoRef = context.trailerInfo.Info;
  const info = infoRef ? context.lookup(infoRef as PDFObject) : undefined;
  if (info instanceof PDFDict) {
    for (const [, rawVal] of info.entries()) {
      const resolved = context.lookup(rawVal);
      const text = decodePdfStringObject(resolved);
      if (text !== null) {
        const reason = inspectMetadataText(text, MAX_INFO_FIELD_CHARS);
        if (reason) {
          violations.push({ code: 'SUSPICIOUS_METADATA', detail: reason });
          break;
        }
      }
    }
  }

  return violations;
}

/**
 * Decodes `PDFString` and `PDFHexString` cleanly: `pdf-lib`'s `PDFHexString`
 * leaves internal whitespace corrupting `asBytes()`, so whitespace inside `<...>`
 * is stripped first per ISO 32000-1 §7.3.4.3.
 */
function decodePdfStringObject(obj: PDFObject | undefined): string | null {
  if (obj instanceof PDFHexString) {
    const compactHex = obj.asString().replace(/^<|>$/g, '').replace(/\s+/g, '');
    try {
      return PDFHexString.of(compactHex).decodeText();
    } catch {
      return compactHex;
    }
  }
  if (obj instanceof PDFString) {
    try {
      return obj.decodeText();
    } catch {
      return obj.asString();
    }
  }
  return null;
}

function decodePdfNameParts(name: PDFName): string[] {
  return normalizePdfNames(name.asString())
    .split('/')
    .filter((part) => part.length > 0);
}

function deduplicateViolations(violations: PdfViolation[]): PdfViolation[] {
  const seen = new Set<string>();
  const unique: PdfViolation[] = [];
  for (const violation of violations) {
    const key = `${violation.code}:${violation.detail ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(violation);
    }
  }
  return unique;
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'el documento no se pudo analizar';
}
