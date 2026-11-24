import { describe, expect, it, vi } from 'vitest';
import { suggestMetadataFromFilename } from './ai-metadata.service.js';
import { searchGoogleBookCovers } from './cover-search.service.js';

describe('suggestMetadataFromFilename', () => {
  it('returns parsed title, author and description from LLM JSON and fails open when unconfigured', async () => {
    const noEnv = await suggestMetadataFromFilename('el-elogio-de-la-sombra.pdf', { env: {} });
    expect(noEnv).toEqual({ title: null, author: null, description: null });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"title":"El elogio de la sombra","author":"Junichiro Tanizaki","description":"Ensayo clásico sobre la estética japonesa de la penumbra."}',
            },
          },
        ],
      }),
    }));

    const res = await suggestMetadataFromFilename('el-elogio-de-la-sombra.pdf', {
      env: { LLM_BASE_URL: 'https://api.nan.builders/v1', LLM_API_KEY: 'test-key' },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(res).toEqual({
      title: 'El elogio de la sombra',
      author: 'Junichiro Tanizaki',
      description: 'Ensayo clásico sobre la estética japonesa de la penumbra.',
    });
  });
});

describe('searchGoogleBookCovers', () => {
  it('merges OpenLibrary and Google Books covers, normalizing http thumbnails and stripping edge=curl', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('openlibrary.org')) {
        return {
          ok: true,
          json: async () => ({
            docs: [{ title: 'La máquina se detiene', author_name: ['E. M. Forster'], cover_i: 999 }],
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
        coverUrl: 'https://covers.openlibrary.org/b/id/999-L.jpg',
      },
    ]);
  });
});
