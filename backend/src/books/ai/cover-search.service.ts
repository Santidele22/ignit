import { suggestCoverSearchQueries } from './ai-metadata.service.js';

export type CoverSearchCandidate = {
  title: string;
  authors: string[];
  coverUrl: string;
};

export type CoverSearchOptions = {
  /** Extra catalog queries (e.g. original-language title + published author name from LLM). */
  altQueries?: string[];
  /** Fallback query expander invoked only when initial catalog queries yield zero relevant covers. */
  expandQueries?: (query: string) => Promise<string[]>;
};

const COVER_SEARCH_TIMEOUT_MS = 6_000;

const STOP_WORDS = new Set([
  'a',
  'al',
  'and',
  'by',
  'con',
  'de',
  'del',
  'el',
  'en',
  'for',
  'in',
  'la',
  'las',
  'lo',
  'los',
  'of',
  'on',
  'para',
  'por',
  'se',
  'the',
  'to',
  'un',
  'una',
  'y',
]);

/**
 * Searches Google Books (when configured), OpenLibrary, Internet Archive,
 * Project Gutenberg (Gutendex), and Wikimedia Commons (open-licensed /
 * public-domain bitmaps) for book cover images matching `title` + `author`,
 * plus optional LLM-suggested alternative queries and a zero-result LLM fallback.
 * Fail-open: returns `[]` on error or timeout.
 */
export async function searchGoogleBookCovers(
  title: string,
  author?: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  options: CoverSearchOptions = {},
): Promise<CoverSearchCandidate[]> {
  const cleanTitle = title.trim();
  const cleanAuthor = author?.trim() ?? '';
  if (!cleanTitle || typeof fetchImpl !== 'function') {
    return [];
  }

  const primaryQuery = cleanAuthor ? `${cleanTitle} ${cleanAuthor}` : cleanTitle;
  const initialQueries = buildInitialQueries(cleanTitle, cleanAuthor, options.altQueries ?? []);

  let relevant = await searchAcrossQueries(initialQueries, cleanTitle, fetchImpl);

  if (relevant.length === 0) {
    const expander = options.expandQueries ?? suggestCoverSearchQueries;
    const expanded = (await expander(primaryQuery)).filter(
      (q) => !initialQueries.some((existing) => existing.toLowerCase() === q.toLowerCase()),
    );
    if (expanded.length > 0) {
      relevant = await searchAcrossQueries(expanded.slice(0, 3), cleanTitle, fetchImpl);
    }
  }

  return relevant.slice(0, 12);
}

function buildInitialQueries(title: string, author: string, altQueries: string[]): string[] {
  const list: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    const key = q.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push(q);
  };

  add(author ? `${title} ${author}` : title);
  for (const alt of altQueries) {
    add(alt);
    if (list.length >= 3) break;
  }

  // If the author has 3+ words (e.g. "Edward Morgan Forster"), also try title + surname.
  if (list.length < 3 && author) {
    const parts = author.split(/\s+/).filter(Boolean);
    if (parts.length >= 3) {
      add(`${title} ${parts[parts.length - 1]}`);
    }
  }

  return list;
}

async function searchAcrossQueries(
  queries: string[],
  fallbackTitle: string,
  fetchImpl: typeof fetch,
): Promise<CoverSearchCandidate[]> {
  const batches = await Promise.all(
    queries.map((query) => queryAllCatalogs(query, fallbackTitle, fetchImpl)),
  );

  const queryTokenSets = queries.map((q) => tokenize(q));
  const merged: Array<{ candidate: CoverSearchCandidate; score: number; order: number }> = [];
  const seen = new Set<string>();
  let order = 0;

  for (const batch of batches) {
    for (const candidate of batch) {
      if (seen.has(candidate.coverUrl)) continue;
      seen.add(candidate.coverUrl);
      const score = scoreCandidate(candidate, queryTokenSets);
      if (score <= 0) continue;
      merged.push({ candidate, score, order: order++ });
    }
  }

  merged.sort((a, b) => b.score - a.score || a.order - b.order);
  return merged.map((entry) => entry.candidate);
}

async function queryAllCatalogs(
  query: string,
  fallbackTitle: string,
  fetchImpl: typeof fetch,
): Promise<CoverSearchCandidate[]> {
  const [google, openLibrary, internetArchive, gutendex, wikimedia] = await Promise.all([
    queryGoogleVolumes(query, fallbackTitle, fetchImpl),
    queryOpenLibraryCovers(query, fallbackTitle, fetchImpl),
    queryInternetArchiveCovers(query, fallbackTitle, fetchImpl),
    queryGutendexCovers(query, fallbackTitle, fetchImpl),
    queryWikimediaCommonsCovers(query, fallbackTitle, fetchImpl),
  ]);
  return [...google, ...openLibrary, ...internetArchive, ...gutendex, ...wikimedia];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function scoreCandidate(candidate: CoverSearchCandidate, queryTokenSets: string[][]): number {
  const titleTokens = new Set(tokenize(candidate.title));
  const authorTokens = new Set(tokenize(candidate.authors.join(' ')));
  const allCandidateTokens = new Set([...titleTokens, ...authorTokens]);
  if (allCandidateTokens.size === 0) return 0;

  let bestScore = 0;
  for (const qTokens of queryTokenSets) {
    if (qTokens.length === 0) continue;
    let titleHits = 0;
    let totalHits = 0;
    for (const token of qTokens) {
      if (titleTokens.has(token)) titleHits += 1;
      if (allCandidateTokens.has(token)) totalHits += 1;
    }
    if (titleHits === 0) continue;
    const ratio = totalHits / qTokens.length;
    const score = titleHits * 2 + ratio * 4;
    if (score > bestScore) bestScore = score;
  }
  return bestScore;
}

const WIKIMEDIA_USER_AGENT = 'IgnitLibrary/1.0 (https://ignit.ezedelebecq22.workers.dev)';
const ALLOWED_WIKIMEDIA_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

async function queryWikimediaCommonsCovers(
  query: string,
  fallbackTitle: string,
  fetchImpl: typeof fetch,
): Promise<CoverSearchCandidate[]> {
  const search = `${query} filetype:bitmap`;
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(search)}&gsrlimit=6&prop=imageinfo&iiprop=url|mime&iiurlwidth=600&format=json`;
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'user-agent': WIKIMEDIA_USER_AGENT,
      },
      signal: AbortSignal.timeout(COVER_SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            title?: unknown;
            imageinfo?: Array<{
              mime?: unknown;
              thumburl?: unknown;
              url?: unknown;
            }>;
          }
        >;
      };
    };
    const pages = data.query?.pages;
    if (!pages || typeof pages !== 'object') return [];

    const results: CoverSearchCandidate[] = [];
    for (const page of Object.values(pages)) {
      const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : undefined;
      if (!info || typeof info.mime !== 'string' || !ALLOWED_WIKIMEDIA_MIMES.has(info.mime)) {
        continue;
      }
      const rawUrl =
        typeof info.thumburl === 'string' && info.thumburl.trim()
          ? info.thumburl.trim()
          : typeof info.url === 'string' && info.url.trim()
            ? info.url.trim()
            : null;
      if (!rawUrl || !rawUrl.startsWith('https://')) continue;

      const rawTitle =
        typeof page.title === 'string'
          ? page.title.replace(/^File:/i, '').replace(/\.[a-z0-9]{2,5}$/i, '').trim()
          : '';
      results.push({
        title: rawTitle || fallbackTitle,
        authors: ['Wikimedia Commons'],
        coverUrl: rawUrl,
      });
    }
    return results;
  } catch {
    return [];
  }
}

async function queryInternetArchiveCovers(
  query: string,
  fallbackTitle: string,
  fetchImpl: typeof fetch,
): Promise<CoverSearchCandidate[]> {
  const search = `${query} AND mediatype:texts`;
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(search)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=6&output=json`;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(COVER_SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      response?: {
        docs?: Array<{
          identifier?: unknown;
          title?: unknown;
          creator?: unknown;
        }>;
      };
    };
    const docs = data.response?.docs;
    if (!Array.isArray(docs)) return [];

    const results: CoverSearchCandidate[] = [];
    for (const doc of docs) {
      if (typeof doc.identifier !== 'string' || !doc.identifier.trim()) continue;
      const id = doc.identifier.trim();
      const authors = Array.isArray(doc.creator)
        ? doc.creator.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        : typeof doc.creator === 'string' && doc.creator.trim().length > 0
          ? [doc.creator.trim()]
          : [];
      results.push({
        title: typeof doc.title === 'string' && doc.title.trim() ? doc.title.trim() : fallbackTitle,
        authors,
        coverUrl: `https://archive.org/services/img/${encodeURIComponent(id)}`,
      });
    }
    return results;
  } catch {
    return [];
  }
}

async function queryGutendexCovers(
  query: string,
  fallbackTitle: string,
  fetchImpl: typeof fetch,
): Promise<CoverSearchCandidate[]> {
  const url = `https://gutendex.com/books/?search=${encodeURIComponent(query)}`;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(COVER_SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      results?: Array<{
        title?: unknown;
        authors?: Array<{ name?: unknown }>;
        formats?: Record<string, unknown>;
      }>;
    };
    if (!Array.isArray(data.results)) return [];

    const results: CoverSearchCandidate[] = [];
    for (const item of data.results.slice(0, 6)) {
      const rawCover = item.formats?.['image/jpeg'];
      if (typeof rawCover !== 'string' || !/^https?:\/\//i.test(rawCover.trim())) continue;
      const coverUrl = rawCover.trim().replace(/^http:\/\//i, 'https://');
      const authors = Array.isArray(item.authors)
        ? item.authors
            .map((a) => (typeof a?.name === 'string' ? a.name.trim() : ''))
            .filter((name) => name.length > 0)
        : [];
      results.push({
        title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : fallbackTitle,
        authors,
        coverUrl,
      });
    }
    return results;
  } catch {
    return [];
  }
}

async function queryOpenLibraryCovers(
  query: string,
  fallbackTitle: string,
  fetchImpl: typeof fetch,
): Promise<CoverSearchCandidate[]> {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10&fields=title,author_name,cover_i`;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(COVER_SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      docs?: Array<{
        title?: unknown;
        author_name?: unknown;
        cover_i?: unknown;
      }>;
    };
    if (!Array.isArray(data.docs)) return [];

    const results: CoverSearchCandidate[] = [];
    for (const doc of data.docs) {
      if (typeof doc.cover_i !== 'number' || !Number.isFinite(doc.cover_i)) {
        continue;
      }
      results.push({
        title: typeof doc.title === 'string' ? doc.title : fallbackTitle,
        authors: Array.isArray(doc.author_name)
          ? doc.author_name.filter((a): a is string => typeof a === 'string')
          : [],
        coverUrl: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`,
      });
    }
    return results;
  } catch {
    return [];
  }
}

async function queryGoogleVolumes(
  query: string,
  fallbackTitle: string,
  fetchImpl: typeof fetch,
): Promise<CoverSearchCandidate[]> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY?.trim();
  const keyParam = apiKey ? `&key=${encodeURIComponent(apiKey)}` : '';
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=8&printType=books${keyParam}`;

  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(COVER_SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      items?: Array<{
        volumeInfo?: {
          title?: unknown;
          authors?: unknown;
          imageLinks?: { thumbnail?: unknown; smallThumbnail?: unknown };
        };
      }>;
    };
    if (!Array.isArray(data.items)) return [];

    const results: CoverSearchCandidate[] = [];
    for (const item of data.items) {
      const info = item?.volumeInfo;
      if (!info) continue;
      const rawThumb =
        typeof info.imageLinks?.thumbnail === 'string'
          ? info.imageLinks.thumbnail
          : typeof info.imageLinks?.smallThumbnail === 'string'
            ? info.imageLinks.smallThumbnail
            : null;
      if (!rawThumb) continue;
      const coverUrl = rawThumb
        .replace(/^http:\/\//i, 'https://')
        .replace(/&edge=curl/gi, '');
      results.push({
        title: typeof info.title === 'string' ? info.title : fallbackTitle,
        authors: Array.isArray(info.authors)
          ? info.authors.filter((a): a is string => typeof a === 'string')
          : [],
        coverUrl,
      });
    }
    return results;
  } catch {
    return [];
  }
}
