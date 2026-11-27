import { describe, expect, it, vi } from 'vitest';
import type { BookReadingDocument } from '../reading/reading.types.js';
import { generateBookBlueprint, parseBookBlueprint } from './ai-blueprint.js';

const ENV = {
  LLM_BASE_URL: 'https://api.example.com/v1',
  LLM_API_KEY: 'test-key',
  LLM_MODEL: 'deepseek-v4-flash',
} satisfies NodeJS.ProcessEnv;

function makeSampleDoc(count = 20): BookReadingDocument {
  return {
    bookId: '58',
    pdfPages: 30,
    ocrPending: false,
    chunks: Array.from({ length: count }, (_, i) => ({
      id: `p0001.${String(i * 10).padStart(4, '0')}`,
      type: i === 0 ? 'heading' : 'para',
      page: i + 1,
      offset: i * 10,
      text: i === 0 ? 'D' : `Párrafo de ejemplo número ${i} del libro en español.`,
      mood: 'espera',
      cues: [],
    })),
  };
}

describe('ai-blueprint', () => {
  it('parses valid blueprint JSON and ignores malformed payloads', () => {
    expect(parseBookBlueprint(null)).toBeNull();
    expect(
      parseBookBlueprint({
        choices: [
          {
            message: {
              content: JSON.stringify({
                genre: 'essay',
                bodyStartChunkId: 'p0001.0030',
                headingConvention: 'PARTE I..VI',
                qualityAlerts: ['Títulos en versalitas truncados'],
              }),
            },
          },
        ],
      }),
    ).toEqual({
      genre: 'essay',
      bodyStartChunkId: 'p0001.0030',
      headingConvention: 'PARTE I..VI',
      qualityAlerts: ['Títulos en versalitas truncados'],
    });
  });

  it('calls LLM with response_format json_object and returns BookBlueprint', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"genre":"technical","bodyStartChunkId":"p0001.0020","headingConvention":"1.1 Sección","qualityAlerts":[]}',
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const bp = await generateBookBlueprint(makeSampleDoc(), {
      env: ENV,
      fetchImpl: fetchMock as unknown as typeof fetch,
      bookMeta: { title: 'Introducción a C', author: 'Marzal' },
    });

    expect(bp).toEqual({
      genre: 'technical',
      bodyStartChunkId: 'p0001.0020',
      headingConvention: '1.1 Sección',
      qualityAlerts: [],
    });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });
});
