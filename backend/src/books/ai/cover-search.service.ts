export type CoverSearchCandidate = {
  title: string;
  authors: string[];
  coverUrl: string;
};

const COVER_SEARCH_TIMEOUT_MS = 6_000;

/**
 * Searches OpenLibrary (zero-quota public catalog) and, when available,
 * Google Books for real book cover images matching `title` + `author`.
 * Fail-open: returns `[]` on error or timeout.
 */
export async function searchGoogleBookCovers(
  title: string,
  author?: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<CoverSearchCandidate[]> {
  const cleanTitle = title.trim();
  const cleanAuthor = author?.trim() ?? '';
  if (!cleanTitle || typeof fetchImpl !== 'function') {
    return [];
  }

  const query = cleanAuthor ? `${cleanTitle} ${cleanAuthor}` : cleanTitle;
  const [openLibrary, google] = await Promise.all([
    queryOpenLibraryCovers(query, cleanTitle, fetchImpl),
    queryGoogleVolumes(query, cleanTitle, fetchImpl),
  ]);

  const merged: CoverSearchCandidate[] = [];
  const seen = new Set<string>();
  for (const item of [...google, ...openLibrary]) {
    if (seen.has(item.coverUrl)) continue;
    seen.add(item.coverUrl);
    merged.push(item);
  }
  return merged.slice(0, 12);
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
