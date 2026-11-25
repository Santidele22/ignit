import { describe, expect, it, vi } from 'vitest';
import {
  suggestCoverSearchQueries,
  suggestMetadataFromFilename,
} from './ai-metadata.service.js';
import { searchGoogleBookCovers } from './cover-search.service.js';

describe('suggestMetadataFromFilename', () => {
  it('returns parsed title, author, description and coverQueries from LLM JSON and fails open when unconfigured', async () => {
    const noEnv = await suggestMetadataFromFilename('el-elogio-de-la-sombra.pdf', { env: {} });
    expect(noEnv).toEqual({ title: null, author: null, description: null, coverQueries: [] });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"title":"La máquina se detiene","author":"E. M. Forster","description":"Relato distópico sobre una humanidad dependiente de una máquina.","coverQueries":["La máquina se detiene E. M. Forster","The Machine Stops E. M. Forster"]}',
            },
          },
        ],
      }),
    }));

    const res = await suggestMetadataFromFilename('la-maquina-se-detiene-por-e.m.-forster-1909.pdf', {
      env: { LLM_BASE_URL: 'https://api.nan.builders/v1', LLM_API_KEY: 'test-key' },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(res).toEqual({
      title: 'La máquina se detiene',
      author: 'E. M. Forster',
      description: 'Relato distópico sobre una humanidad dependiente de una máquina.',
      coverQueries: ['La máquina se detiene E. M. Forster', 'The Machine Stops E. M. Forster'],
    });
  });
});

describe('suggestCoverSearchQueries', () => {
  it('returns alternative catalog queries from LLM JSON and fails open when unconfigured', async () => {
    expect(await suggestCoverSearchQueries('La máquina se detiene Edward Morgan Forster', { env: {} })).toEqual([]);

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"queries":["The Machine Stops E. M. Forster","La máquina se detiene Forster"]}',
            },
          },
        ],
      }),
    }));

    const queries = await suggestCoverSearchQueries('La máquina se detiene Edward Morgan Forster', {
      env: { LLM_BASE_URL: 'https://api.nan.builders/v1', LLM_API_KEY: 'test-key' },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(queries).toEqual(['The Machine Stops E. M. Forster', 'La máquina se detiene Forster']);
  });
});

describe('searchGoogleBookCovers', () => {
  it('merges Google Books, Apple Books (upscaled to 600x600bb) and OpenLibrary covers', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('openlibrary.org')) {
        return {
          ok: true,
          json: async () => ({
            docs: [{ title: 'La máquina se detiene', author_name: ['E. M. Forster'], cover_i: 999 }],
          }),
        };
      }
      if (url.includes('itunes.apple.com')) {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                trackName: 'La máquina se detiene',
                artistName: 'E. M. Forster',
                artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/abc/100x100bb.jpg',
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              volumeInfo: {
                title: 'La máquina se detiene',
                authors: ['E. M. Forster'],
                imageLinks: {
                  thumbnail: 'http://books.google.com/books/content?id=123&printsec=frontcover&img=1&edge=curl',
                },
              },
            },
          ],
        }),
      };
    });

    const covers = await searchGoogleBookCovers(
      'La máquina se detiene',
      'E. M. Forster',
      fetchMock as unknown as typeof fetch,
      { expandQueries: async () => [] },
    );
    expect(covers).toEqual([
      {
        title: 'La máquina se detiene',
        authors: ['E. M. Forster'],
        coverUrl: 'https://books.google.com/books/content?id=123&printsec=frontcover&img=1',
      },
      {
        title: 'La máquina se detiene',
        authors: ['E. M. Forster'],
        coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/abc/600x600bb.jpg',
      },
      {
        title: 'La máquina se detiene',
        authors: ['E. M. Forster'],
        coverUrl: 'https://covers.openlibrary.org/b/id/999-L.jpg',
      },
    ]);
  });

  it('uses altQueries and expandQueries fallback when Spanish query yields no relevant covers, filtering unrelated hits', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('The%20Machine%20Stops')) {
        if (url.includes('openlibrary.org')) {
          return {
            ok: true,
            json: async () => ({
              docs: [{ title: 'The Machine Stops', author_name: ['E. M. Forster'], cover_i: 7793883 }],
            }),
          };
        }
        return { ok: true, json: async () => ({ items: [], results: [] }) };
      }
      // Primary Spanish query returns an unrelated book on OpenLibrary and 429 on Google Books
      if (url.includes('openlibrary.org')) {
        return {
          ok: true,
          json: async () => ({
            docs: [{ title: 'Charlas con Adolfo 1958', author_name: ['German Diograzia'], cover_i: 7335050 }],
          }),
        };
      }
      return { ok: false, status: 429, json: async () => ({}) };
    });

    const expandQueries = vi.fn(async () => ['The Machine Stops E. M. Forster']);
    const covers = await searchGoogleBookCovers(
      'La máquina se detiene',
      'Edward Morgan Forster',
      fetchMock as unknown as typeof fetch,
      { expandQueries },
    );

    expect(expandQueries).toHaveBeenCalledTimes(1);
    expect(covers).toEqual([
      {
        title: 'The Machine Stops',
        authors: ['E. M. Forster'],
        coverUrl: 'https://covers.openlibrary.org/b/id/7793883-L.jpg',
      },
    ]);
  });
});
