import JSZip from 'jszip';
import { isDialogueText, looksLikeSpokenProse } from './reading.block-rules.js';
import { ILLEGIBLE_READING_MESSAGE, assessReadingLegibility } from './reading.legibility.js';
import { classifyMoodAndCues } from './reading.mood.js';
import { dedentRawCodeLines } from './reading.noise.js';
import type {
  BookReadingDocument,
  ReadingChunk,
  ReadingChunkType,
  ReadingInlineMark,
  ReadingInlineRun,
} from './reading.types.js';
import { READING_EXTRACTOR_VERSION } from './reading.types.js';

/**
 * EPUB documents carry no fixed pages, so the reader paginates them by a
 * running character budget (`pdfPages` and `ReadingChunk.page` stay compatible
 * with the PDF path without inventing device-dependent page breaks).
 */
export const EPUB_CHARS_PER_PAGE = 1800;

export type EpubMetadata = {
  title: string | null;
  author: string | null;
  publisher: string | null;
  isbn: string | null;
  description: string | null;
};

export type EpubReadingExtraction = {
  document: BookReadingDocument;
  metadata: EpubMetadata | null;
};

// ── Minimal markup model ─────────────────────────────────────────────────────

type MiniNode = MiniElement | string;

interface MiniElement {
  tag: string;
  attrs: Record<string, string>;
  children: MiniNode[];
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Elements whose text never belongs to the reading surface. */
const SKIP_SUBTREE_TAGS = new Set(['head', 'script', 'style', 'template', 'header', 'footer']);

/** Elements that open their own block; the inline collector never descends into them. */
const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'caption',
  'center',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'html',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

const INLINE_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'big',
  'br',
  'cite',
  'code',
  'del',
  'dfn',
  'em',
  'font',
  'i',
  'ins',
  'kbd',
  'label',
  'mark',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'time',
  'tt',
  'u',
  'var',
]);

const MARK_TAGS: Partial<Record<string, ReadingInlineMark>> = {
  strong: 'b',
  b: 'b',
  em: 'i',
  i: 'i',
  code: 'code',
  kbd: 'code',
  samp: 'code',
};

const TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9:._-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE_RE = /([A-Za-z_:][A-Za-z0-9:._-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  iexcl: '¡',
  iquest: '¿',
  laquo: '«',
  raquo: '»',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  Ntilde: 'Ñ',
  uuml: 'ü',
  Uuml: 'Ü',
  middot: '·',
  deg: '°',
  euro: '€',
};

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[body] ?? match;
  });
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(ATTRIBUTE_RE)) {
    const name = match[1].toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeEntities(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

/**
 * Tiny XML/HTML tree builder. `fast-xml-parser` flattens mixed content into
 * `#text` arrays, so EPUB block mapping keeps its own deterministic walker over
 * this shape instead.
 */
function parseMarkup(markup: string): MiniElement {
  const cleaned = markup
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?[^>]*>/gi, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_match, inner: string) => inner);

  const root: MiniElement = { tag: '#root', attrs: {}, children: [] };
  const stack: MiniElement[] = [root];
  let cursor = 0;

  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(cleaned)) !== null) {
    const parent = stack[stack.length - 1];
    const text = cleaned.slice(cursor, match.index);
    if (text) parent.children.push(decodeEntities(text));
    cursor = TAG_RE.lastIndex;

    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const rawAttrs = match[3] ?? '';

    if (closing) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const element: MiniElement = { tag, attrs: parseAttributes(rawAttrs), children: [] };
    parent.children.push(element);
    if (!VOID_TAGS.has(tag) && !/\/\s*$/.test(rawAttrs)) {
      stack.push(element);
    }
  }

  const trailing = cleaned.slice(cursor);
  if (trailing) stack[stack.length - 1].children.push(decodeEntities(trailing));
  return root;
}

function findElement(node: MiniNode, tag: string): MiniElement | null {
  if (typeof node === 'string') return null;
  if (node.tag === tag) return node;
  for (const child of node.children) {
    const found = findElement(child, tag);
    if (found) return found;
  }
  return null;
}

function rawText(node: MiniNode): string {
  if (typeof node === 'string') return node;
  if (node.tag === 'br') return '\n';
  return node.children.map(rawText).join('');
}

// ── Inline runs ──────────────────────────────────────────────────────────────

function sameMarks(left?: ReadingInlineRun['marks'], right?: ReadingInlineRun['marks']): boolean {
  const a = left ?? [];
  const b = right ?? [];
  return a.length === b.length && a.every((mark, idx) => mark === b[idx]);
}

function pushRun(
  out: ReadingInlineRun[],
  text: string,
  marks: ReadingInlineMark[],
): void {
  if (!text) return;
  const run: ReadingInlineRun = marks.length > 0 ? { text, marks: [...marks] } : { text };
  const last = out[out.length - 1];
  if (last && sameMarks(last.marks, run.marks)) {
    last.text += text;
    return;
  }
  out.push(run);
}

/** Collapses whitespace across runs and trims the outer edges of the block. */
function normalizeRuns(input: readonly ReadingInlineRun[]): ReadingInlineRun[] {
  const out: ReadingInlineRun[] = [];
  let pendingSpace = false;

  for (const run of input) {
    const collapsed = run.text.replace(/\s+/g, ' ');
    if (!collapsed) continue;
    const core = collapsed.trim();
    const marks = run.marks ?? [];
    if (core) {
      const last = out[out.length - 1];
      if (last && (pendingSpace || collapsed.startsWith(' '))) {
        last.text += ' ';
      }
      pushRun(out, core, marks);
      pendingSpace = collapsed.endsWith(' ');
    } else {
      pendingSpace = pendingSpace || collapsed.startsWith(' ');
    }
  }

  const last = out[out.length - 1];
  if (last) {
    last.text = last.text.replace(/\s+$/, '');
    if (!last.text) out.pop();
  }
  return out;
}

function collectInlineRuns(
  nodes: readonly MiniNode[],
  marks: readonly ReadingInlineMark[],
  out: ReadingInlineRun[],
): void {
  for (const node of nodes) {
    if (typeof node === 'string') {
      pushRun(out, node, marks as ReadingInlineMark[]);
      continue;
    }
    if (node.tag === 'br') {
      pushRun(out, ' ', marks as ReadingInlineMark[]);
      continue;
    }
    if (BLOCK_TAGS.has(node.tag) || !INLINE_TAGS.has(node.tag)) continue;
    const mark = MARK_TAGS[node.tag];
    const nextMarks = mark && !marks.includes(mark) ? [...marks, mark] : marks;
    collectInlineRuns(node.children, nextMarks, out);
  }
}

function inlineRuns(nodes: readonly MiniNode[]): ReadingInlineRun[] {
  const raw: ReadingInlineRun[] = [];
  collectInlineRuns(nodes, [], raw);
  return normalizeRuns(raw);
}

function runsText(runs: readonly ReadingInlineRun[]): string {
  return runs.map((run) => run.text).join('');
}

/** Mirrors the PDF path: `runs` only survive when at least one carries a mark. */
function markedRuns(runs: readonly ReadingInlineRun[]): ReadingInlineRun[] | undefined {
  return runs.some((run) => run.marks && run.marks.length > 0) ? [...runs] : undefined;
}

// ── Block mapping ────────────────────────────────────────────────────────────

interface EpubBlock {
  type: ReadingChunkType;
  text: string;
  level?: 1 | 2 | 3;
  runs?: ReadingInlineRun[];
  ordered?: boolean;
  items?: string[];
  align?: 'left' | 'center' | 'right';
}

const HEADING_LEVELS: Record<string, 1 | 2 | 3> = {
  h1: 1,
  h2: 1,
  h3: 2,
  h4: 3,
  h5: 3,
  h6: 3,
};

function pushText(out: EpubBlock[], type: ReadingChunkType, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  out.push({ type, text: trimmed });
}

function walkChildren(nodes: readonly MiniNode[], out: EpubBlock[]): void {
  for (const node of nodes) {
    if (typeof node !== 'string') walkElement(node, out);
  }
}

function walkElement(element: MiniElement, out: EpubBlock[]): void {
  const tag = element.tag;

  if (SKIP_SUBTREE_TAGS.has(tag)) return;
  if (tag === 'aside' && isFootnote(element)) return;
  if (tag === 'nav') {
    walkNav(element, out);
    return;
  }

  const headingLevel = HEADING_LEVELS[tag];
  if (headingLevel) {
    pushHeading(element, headingLevel, out);
    return;
  }

  switch (tag) {
    case 'p':
      pushParagraph(element, out);
      return;
    case 'blockquote':
      pushQuote(element, out);
      return;
    case 'pre':
      pushCode(element, out);
      return;
    case 'ul':
    case 'ol':
      pushList(element, out);
      return;
    case 'figcaption':
      pushText(out, 'caption', runsText(inlineRuns(element.children)));
      return;
    case 'figure':
      walkFigure(element, out);
      return;
    default:
      walkContainer(element, out);
  }
}

function isFootnote(element: MiniElement): boolean {
  const type = (element.attrs['epub:type'] ?? element.attrs.type ?? '').toLowerCase();
  const role = (element.attrs.role ?? '').toLowerCase();
  return type.includes('footnote') || type.includes('endnote') || role === 'doc-footnote';
}

function isTocNav(element: MiniElement): boolean {
  const types = (element.attrs['epub:type'] ?? element.attrs.type ?? '').toLowerCase().split(/\s+/);
  if (types.includes('toc')) return true;
  const role = (element.attrs.role ?? '').toLowerCase();
  return role === 'doc-toc' || role === 'toc';
}

function pushHeading(element: MiniElement, level: 1 | 2 | 3, out: EpubBlock[]): void {
  const text = runsText(inlineRuns(element.children));
  const trimmed = text.trim();
  if (!trimmed) return;
  const block: EpubBlock = {
    type: 'heading',
    text: trimmed,
    level,
    align: (element.attrs.style ?? '').includes('center') ? 'center' : 'left',
  };
  out.push(block);
}

function pushParagraph(element: MiniElement, out: EpubBlock[]): void {
  const runs = inlineRuns(element.children);
  const text = runsText(runs);
  if (!text.trim()) return;
  const block: EpubBlock = { type: isDialogueText(text) ? 'dialogue' : 'para', text };
  const marked = markedRuns(runs);
  if (marked) block.runs = marked;
  out.push(block);
}

function pushQuote(element: MiniElement, out: EpubBlock[]): void {
  const parts: string[] = [];
  const collect = (node: MiniNode): void => {
    if (typeof node === 'string') return;
    if (node.tag === 'p' || node.tag === 'div' || node.tag === 'br') {
      const text = runsText(inlineRuns(node.children)).trim();
      if (text) parts.push(text);
      return;
    }
    if (BLOCK_TAGS.has(node.tag)) {
      for (const child of node.children) collect(child);
      return;
    }
    // Inline content directly inside the blockquote.
    const text = runsText(inlineRuns([node])).trim();
    if (text) parts.push(text);
  };

  const direct = runsText(inlineRuns(element.children.filter(isInlineNode))).trim();
  if (direct) parts.push(direct);
  for (const child of element.children) {
    if (typeof child !== 'string' && BLOCK_TAGS.has(child.tag)) collect(child);
  }

  const text = parts.join('\n').trim();
  if (!text) return;
  out.push({ type: isDialogueText(text) ? 'dialogue' : 'quote', text });
}

function isInlineNode(node: MiniNode): node is MiniElement | string {
  return typeof node === 'string' || !BLOCK_TAGS.has((node as MiniElement).tag);
}

function pushCode(element: MiniElement, out: EpubBlock[]): void {
  const raw = rawText(element).replace(/\r\n/g, '\n');
  const lines = dedentRawCodeLines(raw.split('\n'));
  while (lines.length > 0 && !lines[0].trim()) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  const text = lines.join('\n');
  if (!text.trim()) return;
  if (isDialogueText(text)) {
    out.push({ type: 'dialogue', text });
    return;
  }
  if (looksLikeSpokenProse(text)) {
    out.push({ type: 'para', text });
    return;
  }
  out.push({ type: 'code', text });
}

function listItemText(element: MiniElement): string {
  const collect = (node: MiniNode): string => {
    if (typeof node === 'string') return node;
    if (node.tag === 'ul' || node.tag === 'ol') return '';
    return node.children.map(collect).join(' ');
  };
  return element.children.map(collect).join(' ').replace(/\s+/g, ' ').trim();
}

function pushList(element: MiniElement, out: EpubBlock[]): void {
  const items: string[] = [];
  const collectItems = (node: MiniNode): void => {
    if (typeof node === 'string') return;
    if (node.tag === 'li') {
      const text = listItemText(node);
      if (text) items.push(text);
      // Nested lists keep their own items so no entry is lost.
      for (const child of node.children) {
        if (typeof child !== 'string' && (child.tag === 'ul' || child.tag === 'ol')) {
          collectItems(child);
        }
      }
      return;
    }
    for (const child of node.children) collectItems(child);
  };
  collectItems(element);

  if (items.length === 0) return;
  out.push({
    type: 'list',
    text: items.join('\n'),
    ordered: element.tag === 'ol',
    items,
  });
}

function walkFigure(element: MiniElement, out: EpubBlock[]): void {
  const captions = element.children.filter(
    (child): child is MiniElement => typeof child !== 'string' && child.tag === 'figcaption',
  );
  if (captions.length === 0) {
    walkContainer(element, out);
    return;
  }
  for (const caption of captions) {
    pushText(out, 'caption', runsText(inlineRuns(caption.children)));
  }
}

function collectNavEntries(element: MiniElement, entries: string[]): void {
  for (const child of element.children) {
    if (typeof child === 'string') continue;
    if (child.tag === 'a') {
      const title = runsText(inlineRuns(child.children)).trim();
      if (!title) continue;
      const href = (child.attrs.href ?? '').trim();
      entries.push(href ? `${title}\t${href}` : title);
      continue;
    }
    collectNavEntries(child, entries);
  }
}

function walkNav(element: MiniElement, out: EpubBlock[]): void {
  // Landmarks and page-list navs are navigation boilerplate, not read content.
  if (!isTocNav(element)) return;
  const entries: string[] = [];
  collectNavEntries(element, entries);
  if (entries.length === 0) return;
  out.push({ type: 'toc', text: entries.join('\n') });
}

function walkContainer(element: MiniElement, out: EpubBlock[]): void {
  const before = out.length;
  walkChildren(element.children, out);
  if (out.length > before) return;
  pushParagraph(element, out);
}

function walkDocument(markup: string, out: EpubBlock[]): void {
  const root = parseMarkup(markup);
  const body = findElement(root, 'body') ?? root;
  walkChildren(body.children, out);
}

// ── Package (OPF) and ZIP plumbing ───────────────────────────────────────────

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
}

interface OpfPackage {
  manifest: Map<string, ManifestItem>;
  spine: string[];
  tocId: string | null;
}

const TAG_BODY = '(?:[^>"\']|"[^"]*"|\'[^\']*\')*';

function firstTagAttributes(xml: string, tag: string): Record<string, string> | null {
  const match = new RegExp(`<${tag}\\b(${TAG_BODY})\\/?>`, 'i').exec(xml);
  return match ? parseAttributes(match[1]) : null;
}

function parsePackage(opf: string): OpfPackage {
  const manifest = new Map<string, ManifestItem>();
  for (const match of opf.matchAll(new RegExp(`<item\\b(${TAG_BODY})\\/?>`, 'gi'))) {
    const attrs = parseAttributes(match[1]);
    const id = attrs.id;
    const href = attrs.href;
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      href,
      mediaType: (attrs['media-type'] ?? '').toLowerCase(),
      properties: (attrs.properties ?? '').toLowerCase(),
    });
  }

  const spineAttrs = firstTagAttributes(opf, 'spine') ?? {};
  const spine: string[] = [];
  const spineBody = new RegExp(`<spine\\b${TAG_BODY}>([\\s\\S]*?)<\\/spine>`, 'i').exec(opf);
  if (spineBody) {
    for (const match of spineBody[1].matchAll(new RegExp(`<itemref\\b(${TAG_BODY})\\/?>`, 'gi'))) {
      const idref = parseAttributes(match[1]).idref;
      if (idref) spine.push(idref);
    }
  }

  return { manifest, spine, tocId: spineAttrs.toc ?? null };
}

function normalizeZipPath(path: string): string {
  const stack: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack.join('/');
}

function decodeHref(href: string): string {
  const clean = href.split('#')[0].split('?')[0];
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

/**
 * Resolves a manifest/spine href against the OPF directory, clamping `..` at the
 * ZIP root (`content.opf` + `../../OEBPS/x.xhtml` -> `OEBPS/x.xhtml`).
 */
function resolveHref(baseDir: string, href: string): string {
  const path = decodeHref(href);
  if (path.startsWith('/')) return normalizeZipPath(path);
  return baseDir ? normalizeZipPath(`${baseDir}/${path}`) : normalizeZipPath(path);
}

function dirnameOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

async function readZipText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(normalizeZipPath(path));
  if (!file) return null;
  try {
    return await file.async('string');
  } catch {
    return null;
  }
}

async function findPackagePath(zip: JSZip): Promise<string | null> {
  const container = await readZipText(zip, 'META-INF/container.xml');
  if (container) {
    const rootfile = firstTagAttributes(container, 'rootfile');
    const fullPath = rootfile?.['full-path'];
    if (fullPath) return normalizeZipPath(fullPath);
  }
  const fallback = Object.values(zip.files).find((file) => !file.dir && /\.opf$/i.test(file.name));
  return fallback ? fallback.name : null;
}

function isContentDocument(item: ManifestItem): boolean {
  if (item.mediaType) {
    return item.mediaType === 'application/xhtml+xml' || item.mediaType === 'text/html';
  }
  return /\.x?html?$/i.test(item.href);
}

// ── Metadata ────────────────────────────────────────────────────────────────

function elementMatches(xml: string, name: string): Array<{ attrs: Record<string, string>; text: string }> {
  const qualified = `(?:dc:)?${name}`;
  const re = new RegExp(`<${qualified}\\b(${TAG_BODY})>([\\s\\S]*?)<\\/${qualified}>`, 'gi');
  const out: Array<{ attrs: Record<string, string>; text: string }> = [];
  for (const match of xml.matchAll(re)) {
    out.push({
      attrs: parseAttributes(match[1]),
      text: cleanXmlText(match[2]),
    });
  }
  return out;
}

function cleanXmlText(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function attrOrNull(attrs: Record<string, string>, names: readonly string[]): string | null {
  for (const name of names) {
    const value = attrs[name];
    if (value && value.trim()) return value.trim();
  }
  return null;
}

function normalizeIsbn(raw: string): string | null {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const digits = decoded
    .replace(/^urn:isbn:/i, '')
    .replace(/[^0-9Xx]/g, '')
    .toUpperCase();
  return digits.length === 10 || digits.length === 13 ? digits : null;
}

/**
 * Reads the OPF package metadata. `dc:creator` prefers the `opf:role="aut"`
 * entry (translators and illustrators follow it in most EPUBs) and falls back to
 * the first creator; `isbn` accepts `urn:isbn:` and `opf:scheme="ISBN"` forms.
 */
export function extractEpubMetadata(opf: string): EpubMetadata | null {
  const metadataMatch = new RegExp(
    `<metadata\\b${TAG_BODY}>([\\s\\S]*?)<\\/metadata>`,
    'i',
  ).exec(opf);
  const metadataXml = metadataMatch ? metadataMatch[1] : opf;

  const title = elementMatches(metadataXml, 'title')
    .map((entry) => entry.text)
    .find((text) => text.length > 0) ?? null;

  const creators = elementMatches(metadataXml, 'creator').filter((entry) => entry.text.length > 0);
  const authorEntry =
    creators.find((entry) => (attrOrNull(entry.attrs, ['opf:role', 'role']) ?? '').toLowerCase() === 'aut') ??
    creators[0];
  const author = authorEntry ? authorEntry.text : null;

  const publisher =
    elementMatches(metadataXml, 'publisher')
      .map((entry) => entry.text)
      .find((text) => text.length > 0) ?? null;

  const description =
    elementMatches(metadataXml, 'description')
      .map((entry) => entry.text)
      .find((text) => text.length > 0) ?? null;

  let isbn: string | null = null;
  for (const identifier of elementMatches(metadataXml, 'identifier')) {
    const raw = identifier.text;
    if (!raw) continue;
    const scheme = (attrOrNull(identifier.attrs, ['opf:scheme', 'scheme']) ?? '').toLowerCase();
    if (scheme !== 'isbn' && !/^urn:isbn[:%]/i.test(raw)) continue;
    const normalized = normalizeIsbn(raw);
    if (normalized) {
      isbn = normalized;
      break;
    }
  }

  if (!title && !author && !publisher && !isbn && !description) return null;
  return { title, author, publisher, isbn, description };
}

// ── Chunk assembly ──────────────────────────────────────────────────────────

function pad4(value: number): string {
  return String(Math.min(9999, Math.max(0, Math.trunc(value)))).padStart(4, '0');
}

function buildChunks(blocks: readonly EpubBlock[]): ReadingChunk[] {
  const chunks: ReadingChunk[] = [];
  let charsBefore = 0;

  blocks.forEach((block, index) => {
    const page = Math.floor(charsBefore / EPUB_CHARS_PER_PAGE) + 1;
    const offset = charsBefore - (page - 1) * EPUB_CHARS_PER_PAGE;
    const { mood, cues } = classifyMoodAndCues(block.text, index);
    const chunk: ReadingChunk = {
      id: `p${pad4(page)}.${pad4(offset)}`,
      type: block.type,
      page,
      offset,
      text: block.text,
      mood,
      cues,
    };
    if (block.level !== undefined) chunk.level = block.level;
    if (block.runs !== undefined) chunk.runs = block.runs;
    if (block.ordered !== undefined) chunk.ordered = block.ordered;
    if (block.items !== undefined) chunk.items = block.items;
    if (block.align && block.align !== 'left') chunk.align = block.align;

    chunks.push(chunk);
    charsBefore += block.text.length;
  });

  return chunks;
}

function ncxTocBlock(ncx: string): EpubBlock | null {
  const entries: string[] = [];
  const parts = ncx.split(/<navPoint\b/i).slice(1);
  for (const part of parts) {
    const label = new RegExp(`<text\\b${TAG_BODY}>([\\s\\S]*?)<\\/text>`, 'i').exec(part);
    const content = new RegExp(`<content\\b(${TAG_BODY})\\/?>`, 'i').exec(part);
    const title = label ? cleanXmlText(label[1]) : '';
    if (!title) continue;
    const href = content ? (parseAttributes(content[1]).src ?? '').trim() : '';
    entries.push(href ? `${title}\t${href}` : title);
  }
  if (entries.length === 0) return null;
  return { type: 'toc', text: entries.join('\n') };
}

/**
 * Deterministic EPUB extractor (S5): `container.xml` -> `content.opf` -> spine
 * XHTML mapped to `ReadingChunk`s with synthetic pagination, plus the OPF
 * metadata. Illegible text throws a plain `Error`; empty bodies are returned so
 * the caller can flag `ocrPending`.
 */
export async function extractReadingFromEpub(
  bookId: number,
  buffer: Buffer,
): Promise<EpubReadingExtraction> {
  const zip = await JSZip.loadAsync(buffer);
  const opfPath = await findPackagePath(zip);
  const opf = opfPath ? await readZipText(zip, opfPath) : null;

  const blocks: EpubBlock[] = [];
  let metadata: EpubMetadata | null = null;

  if (opf) {
    metadata = extractEpubMetadata(opf);
    const pkg = parsePackage(opf);
    const baseDir = opfPath ? dirnameOf(opfPath) : '';

    for (const idref of pkg.spine) {
      const item = pkg.manifest.get(idref);
      if (!item || !isContentDocument(item)) continue;
      const markup = await readZipText(zip, resolveHref(baseDir, item.href));
      if (markup) walkDocument(markup, blocks);
    }

    if (!blocks.some((block) => block.type === 'toc')) {
      const ncxItem =
        (pkg.tocId ? pkg.manifest.get(pkg.tocId) : undefined) ??
        [...pkg.manifest.values()].find(
          (item) => item.mediaType === 'application/x-dtbncx+xml',
        );
      if (ncxItem) {
        const ncx = await readZipText(zip, resolveHref(baseDir, ncxItem.href));
        const tocBlock = ncx ? ncxTocBlock(ncx) : null;
        if (tocBlock) blocks.unshift(tocBlock);
      }
    }
  }

  const chunks = buildChunks(blocks);
  const totalChars = blocks.reduce((sum, block) => sum + block.text.length, 0);
  const document: BookReadingDocument = {
    bookId: String(bookId),
    pdfPages: Math.max(1, Math.ceil(totalChars / EPUB_CHARS_PER_PAGE)),
    ocrPending: chunks.length === 0,
    extractorVersion: READING_EXTRACTOR_VERSION,
    chunks,
  };

  if (!assessReadingLegibility(document).legible) {
    throw new Error(ILLEGIBLE_READING_MESSAGE);
  }

  return { document, metadata };
}
