import 'reflect-metadata';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Repository } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '../entities/book.entity.js';
import { attachBookFile, type UploadedPdf } from '../lib/book-file.js';
import type { BookStorage } from '../storage/book-storage.js';
import {
  AI_REQUEST_TIMEOUT_MS,
  AI_TEXT_LIMIT,
  DEFAULT_LLM_MODEL,
} from './ai-analysis.config.js';
import {
  aiColumnsFor,
  analyzeBookText,
  analyzeReadingDocument,
} from './ai-analysis.service.js';

/** A real one-page PDF whose content stream carries Spanish reading text. */
const TEXT_PDF_BUFFER = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    '4 0 obj << /Length 178 >> stream',
    'BT /F1 18 Tf 72 720 Td (Capitulo I: La espera en el invierno) Tj ET',
    'BT /F1 12 Tf 72 680 Td (Drogo contemplaba desde el muro la llanura gris en silencio durante el invierno.) Tj ET',
    'endstream endobj',
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    'xref',
    '0 6',
    '0000000000 65535 f ',
    'trailer << /Root 1 0 R /Size 6 >>',
    '%%EOF',
  ].join('\n'),
);

type FetchCall = { url: string; init: RequestInit };

/** Narrows one `fetch` mock call into `{ url, init }`. */
function fetchCall(fetchMock: ReturnType<typeof vi.fn>, index = 0): FetchCall {
  const call = fetchMock.mock.calls[index] as unknown as [string, RequestInit];
  return { url: call[0], init: call[1] };
}

function chatResponse(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

function stubFetch(handler: () => Promise<Response>) {
  const fetchMock = vi.fn(handler);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const ENV = {
  LLM_BASE_URL: 'https://llm.gentle-nan.test/v1/',
  LLM_API_KEY: 'test-key',
} satisfies NodeJS.ProcessEnv;

describe('analyzeBookText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips without touching the network when the env gate is incomplete', async () => {
    const fetchMock = stubFetch(async () => chatResponse('{"safety":"ok","quality":4,"notes":""}'));

    await expect(analyzeBookText('texto', { env: {} })).resolves.toBeNull();
    await expect(
      analyzeBookText('texto', { env: { LLM_BASE_URL: ENV.LLM_BASE_URL } }),
    ).resolves.toBeNull();
    await expect(
      analyzeBookText('texto', { env: { LLM_API_KEY: ENV.LLM_API_KEY } }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the OpenAI-compatible chat completion and parses the strict JSON verdict', async () => {
    const fetchMock = stubFetch(async () =>
      chatResponse(
        '```json\n{"safety":"suspect","quality":2,"notes":"  Apología de la violencia  "}\n```',
      ),
    );

    const verdict = await analyzeBookText('Drogo afilaba su acero.', { env: ENV });

    expect(verdict).toEqual({
      safety: 'suspect',
      quality: 2,
      notes: 'Apología de la violencia',
    });
    const call = fetchCall(fetchMock);
    expect(call.url).toBe('https://llm.gentle-nan.test/v1/chat/completions');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer test-key',
    });
    const body = JSON.parse(String(call.init.body)) as {
      model: string;
      temperature: number;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe(DEFAULT_LLM_MODEL);
    expect(body.temperature).toBe(0.1);
    expect(body.messages[0]?.role).toBe('system');
    expect(body.messages[0]?.content).toMatch(/JSON/);
    expect(body.messages[1]?.role).toBe('user');
    expect(body.messages[1]?.content).toBe('Drogo afilaba su acero.');
  });

  it('honours LLM_MODEL and truncates the reading text to 24k chars', async () => {
    const fetchMock = stubFetch(async () => chatResponse('{"safety":"ok","quality":5,"notes":""}'));
    const longText = 'a'.repeat(AI_TEXT_LIMIT + 5000);

    await analyzeBookText(longText, { env: { ...ENV, LLM_MODEL: 'qwen-plus' } });

    const call = fetchCall(fetchMock);
    const body = JSON.parse(String(call.init.body)) as {
      model: string;
      messages: { content: string }[];
    };
    expect(body.model).toBe('qwen-plus');
    expect(body.messages[1]?.content).toHaveLength(AI_TEXT_LIMIT);
    expect(AI_REQUEST_TIMEOUT_MS).toBe(10_000);
  });

  it('fails open to null when the request rejects', async () => {
    stubFetch(async () => {
      throw new Error('ECONNREFUSED');
    });

    await expect(analyzeBookText('texto', { env: ENV })).resolves.toBeNull();
  });

  it('fails open to null on a non-2xx answer or unparseable content', async () => {
    stubFetch(async () => ({ ok: false, status: 429, json: async () => ({}) }) as unknown as Response);
    await expect(analyzeBookText('texto', { env: ENV })).resolves.toBeNull();

    stubFetch(async () => chatResponse('no soy json'));
    await expect(analyzeBookText('texto', { env: ENV })).resolves.toBeNull();

    stubFetch(async () =>
      chatResponse('{"safety":"quizas","quality":9,"notes":"?"}'),
    );
    await expect(analyzeBookText('texto', { env: ENV })).resolves.toBeNull();
  });

  it('clamps an out-of-range quality onto the 1..5 scale', async () => {
    stubFetch(async () => chatResponse('{"safety":"ok","quality":9,"notes":"denso"}'));
    await expect(analyzeBookText('texto', { env: ENV })).resolves.toEqual({
      safety: 'ok',
      quality: 5,
      notes: 'denso',
    });
  });

  it('never calls the endpoint for an empty reading document', async () => {
    const fetchMock = stubFetch(async () => chatResponse('{"safety":"ok","quality":3,"notes":""}'));

    await expect(
      analyzeReadingDocument({ bookId: '7', pdfPages: 0, ocrPending: true, chunks: [] }, { env: ENV }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('aiColumnsFor', () => {
  it('marks a failed or skipped analysis as skipped with no verdict columns', () => {
    expect(aiColumnsFor(null)).toEqual({
      aiSafety: null,
      aiQuality: null,
      aiNotes: null,
      aiStatus: 'skipped',
    });
  });

  it('maps an ok and a suspect verdict onto the persisted statuses', () => {
    expect(aiColumnsFor({ safety: 'ok', quality: 4, notes: 'claro' })).toEqual({
      aiSafety: 'ok',
      aiQuality: 4,
      aiNotes: 'claro',
      aiStatus: 'ok',
    });
    expect(aiColumnsFor({ safety: 'suspect', quality: 1, notes: 'hostil' })).toEqual({
      aiSafety: 'suspect',
      aiQuality: 1,
      aiNotes: 'hostil',
      aiStatus: 'suspect',
    });
  });
});

describe('attachBookFile AI stage wiring', () => {
  let dir: string;
  let previousUploadDir: string | undefined;
  let previousEnv: { base?: string; key?: string; model?: string };
  let save: ReturnType<typeof vi.fn>;
  let bookStorage: BookStorage;
  let booksRepository: Repository<Book>;
  let book: Book;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'books-ai-'));
    previousUploadDir = process.env.BOOKS_UPLOAD_DIR;
    process.env.BOOKS_UPLOAD_DIR = dir;
    previousEnv = {
      base: process.env.LLM_BASE_URL,
      key: process.env.LLM_API_KEY,
      model: process.env.LLM_MODEL,
    };
    process.env.LLM_BASE_URL = ENV.LLM_BASE_URL;
    process.env.LLM_API_KEY = ENV.LLM_API_KEY;
    delete process.env.LLM_MODEL;

    save = vi.fn(async (row: Book) => row);
    bookStorage = {
      strategy: 'local',
      persist: vi.fn(async (_id: number, file: { path: string }) => file.path),
      remove: vi.fn(async () => undefined),
      resolveDownload: vi.fn(),
    } as unknown as BookStorage;
    booksRepository = { save } as unknown as Repository<Book>;
    book = { id: 7, filePath: null, published: false, ownerId: 'user-a' } as Book;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (previousUploadDir === undefined) delete process.env.BOOKS_UPLOAD_DIR;
    else process.env.BOOKS_UPLOAD_DIR = previousUploadDir;
    for (const [name, value] of [
      ['LLM_BASE_URL', previousEnv.base],
      ['LLM_API_KEY', previousEnv.key],
      ['LLM_MODEL', previousEnv.model],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });

  async function uploadedPdf(): Promise<UploadedPdf> {
    const path = join(dir, 'invierno.pdf');
    await writeFile(path, TEXT_PDF_BUFFER);
    return {
      path,
      originalname: 'invierno.pdf',
      size: TEXT_PDF_BUFFER.byteLength,
      mimetype: 'application/pdf',
    };
  }

  it('persists the AI verdict columns without blocking the upload', async () => {
    const fetchMock = stubFetch(async () =>
      chatResponse('{"safety":"ok","quality":4,"notes":"prosa clara"}'),
    );

    const saved = await attachBookFile(booksRepository, bookStorage, book, await uploadedPdf());

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const body = JSON.parse(String(fetchCall(fetchMock, 2).init.body)) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages[1]?.content).toContain('Drogo');
    expect(saved).toMatchObject({
      aiSafety: 'ok',
      aiQuality: 4,
      aiNotes: 'prosa clara',
      aiStatus: 'ok',
      filePages: 1,
      originalName: 'invierno.pdf',
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('keeps the upload green and records skipped when the model call fails', async () => {
    stubFetch(async () => {
      throw new Error('timeout');
    });

    const saved = await attachBookFile(booksRepository, bookStorage, book, await uploadedPdf());

    expect(saved).toMatchObject({
      aiSafety: null,
      aiQuality: null,
      aiNotes: null,
      aiStatus: 'skipped',
      originalName: 'invierno.pdf',
    });
    expect(saved.filePath).toBeTruthy();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
