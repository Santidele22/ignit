import { describe, expect, it, vi } from 'vitest';
import {
  suggestCoverSearchQueries,
  suggestMetadataFromFilename,
  verifyLicenseFromBookContent,
} from './ai-metadata.service.js';
import { searchGoogleBookCovers } from './cover-search.service.js';

describe('suggestMetadataFromFilename', () => {
  it('returns parsed title, author, description, coverQueries and open license verdict from LLM JSON and fails open when unconfigured', async () => {
    const noEnv = await suggestMetadataFromFilename('el-elogio-de-la-sombra.pdf', { env: {} });
    expect(noEnv).toEqual({
      title: null,
      author: null,
      description: null,
      coverQueries: [],
      license: null,
      licenseStatus: 'unknown',
      licenseReason: null,
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"title":"La máquina se detiene","author":"E. M. Forster","description":"Relato distópico sobre una humanidad dependiente de una máquina.","coverQueries":["La máquina se detiene E. M. Forster","The Machine Stops E. M. Forster"],"license":"Dominio público","licenseStatus":"open","licenseReason":"Obra publicada en 1909 en dominio público."}',
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
      license: 'Dominio público',
      licenseStatus: 'open',
      licenseReason: 'Obra publicada en 1909 en dominio público.',
    });
  });

  it('marks copyrighted books as personal-only and strips non-open license strings', async () => {
    const copyrightedFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"title":"Harry Potter","author":"J. K. Rowling","description":"Novela de fantasía.","coverQueries":["Harry Potter J. K. Rowling"],"license":"Todos los derechos reservados","licenseStatus":"copyrighted","licenseReason":"Obra comercial con derechos de autor vigentes."}',
            },
          },
        ],
      }),
    }));

    const copyrighted = await suggestMetadataFromFilename('harry-potter.pdf', {
      env: { LLM_BASE_URL: 'https://api.nan.builders/v1', LLM_API_KEY: 'test-key' },
      fetchImpl: copyrightedFetch as unknown as typeof fetch,
    });
    expect(copyrighted.licenseStatus).toBe('copyrighted');
    expect(copyrighted.license).toBeNull();
    expect(copyrighted.licenseReason).toContain('derechos de autor');

    // Defense-in-depth: if the LLM claims "open" with a non-open license string, downgrade to unknown
    const spoofedFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"title":"Libro","author":"Autor","description":"Desc","coverQueries":[],"license":"Autorización editorial","licenseStatus":"open","licenseReason":"Permiso"}',
            },
          },
        ],
      }),
    }));
    const spoofed = await suggestMetadataFromFilename('libro.pdf', {
      env: { LLM_BASE_URL: 'https://api.nan.builders/v1', LLM_API_KEY: 'test-key' },
      fetchImpl: spoofedFetch as unknown as typeof fetch,
    });
    expect(spoofed.licenseStatus).toBe('unknown');
    expect(spoofed.license).toBeNull();
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
  it('merges Google Books, OpenLibrary, Internet Archive, Gutendex and Wikimedia Commons covers (ignoring non-image files)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('openlibrary.org')) {
        return {
          ok: true,
          json: async () => ({
            docs: [{ title: 'La máquina se detiene', author_name: ['E. M. Forster'], cover_i: 999 }],
          }),
        };
      }
      if (url.includes('archive.org')) {
        return {
          ok: true,
          json: async () => ({
            response: {
              docs: [
                {
                  identifier: 'lamaquinasedetiene1909',
                  title: 'La máquina se detiene',
                  creator: 'E. M. Forster',
                },
              ],
            },
          }),
        };
      }
      if (url.includes('gutendex.com')) {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                title: 'La máquina se detiene',
                authors: [{ name: 'Forster, E. M.' }],
                formats: {
                  'image/jpeg': 'https://www.gutenberg.org/cache/epub/72890/pg72890.cover.medium.jpg',
                },
              },
            ],
          }),
        };
      }
      if (url.includes('commons.wikimedia.org')) {
        return {
          ok: true,
          json: async () => ({
            query: {
              pages: {
                '1': {
                  title: 'File:La máquina se detiene 1909.jpg',
                  imageinfo: [
                    {
                      mime: 'image/jpeg',
                      thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/forster.jpg/600px-forster.jpg',
                    },
                  ],
                },
                '2': {
                  title: 'File:La máquina se detiene audio.ogg',
                  imageinfo: [
                    {
                      mime: 'application/ogg',
                      thumburl: 'https://commons.wikimedia.org/w/resources/assets/file-type-icons/fileicon-ogg.png',
                    },
                  ],
                },
              },
            },
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
        coverUrl: 'https://covers.openlibrary.org/b/id/999-L.jpg',
      },
      {
        title: 'La máquina se detiene',
        authors: ['E. M. Forster'],
        coverUrl: 'https://archive.org/services/img/lamaquinasedetiene1909',
      },
      {
        title: 'La máquina se detiene',
        authors: ['Forster, E. M.'],
        coverUrl: 'https://www.gutenberg.org/cache/epub/72890/pg72890.cover.medium.jpg',
      },
      {
        title: 'La máquina se detiene 1909',
        authors: ['Wikimedia Commons'],
        coverUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/forster.jpg/600px-forster.jpg',
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

describe('verifyLicenseFromBookContent', () => {
  it('verifies open vs copyrighted license from extracted book text and fails open to unknown', async () => {
    expect(
      await verifyLicenseFromBookContent({ textSample: 'Contenido de prueba' }, { env: {} }),
    ).toEqual({
      license: null,
      licenseStatus: 'unknown',
      licenseReason: null,
    });

    const openFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"license":"Dominio público","licenseStatus":"open","licenseReason":"Autor fallecido en 1910."}',
            },
          },
        ],
      }),
    }));
    const openVerdict = await verifyLicenseFromBookContent(
      { title: 'La muerte de Iván Ilich', author: 'León Tolstói', textSample: 'En el gran edificio...' },
      {
        env: { LLM_BASE_URL: 'https://api.nan.builders/v1', LLM_API_KEY: 'test-key' },
        fetchImpl: openFetch as unknown as typeof fetch,
      },
    );
    expect(openVerdict).toEqual({
      license: 'Dominio público',
      licenseStatus: 'open',
      licenseReason: 'Autor fallecido en 1910.',
    });

    const closedFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"license":"","licenseStatus":"copyrighted","licenseReason":"Todos los derechos reservados."}',
            },
          },
        ],
      }),
    }));
    const closedVerdict = await verifyLicenseFromBookContent(
      { title: 'Obra Moderna', textSample: '© 2024 Editorial Comercial. Todos los derechos reservados.' },
      {
        env: { LLM_BASE_URL: 'https://api.nan.builders/v1', LLM_API_KEY: 'test-key' },
        fetchImpl: closedFetch as unknown as typeof fetch,
      },
    );
    expect(closedVerdict.licenseStatus).toBe('copyrighted');
    expect(closedVerdict.license).toBeNull();
  });
});
