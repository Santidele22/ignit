import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getJson } from '../../../shared/api/http';
import {
	getJson as authorizedGetJson,
	putJson as authorizedPutJson,
} from '../../../shared/api/authorizedHttp';
import {
	fetchBookById,
	fetchBookClientReading,
	fetchBookReading,
	fetchBookReadingState,
	fetchBooks,
	fetchBooksPage,
	fetchDemoFeaturedBookId,
	saveBookReadingState,
} from './books';
import { fetchMyBooks } from './books-admin';

vi.mock('../../../shared/api/http', () => ({ getJson: vi.fn(), putJson: vi.fn() }));
vi.mock('../../../shared/api/authorizedHttp', () => ({
	getJson: vi.fn(),
	putJson: vi.fn(),
	postJson: vi.fn(),
	patchJson: vi.fn(),
	deleteJson: vi.fn(),
	getBearerToken: vi.fn(),
}));

const getJsonMock = vi.mocked(getJson);
const authorizedGetJsonMock = vi.mocked(authorizedGetJson);
const authorizedPutJsonMock = vi.mocked(authorizedPutJson);

const row = (overrides: Record<string, unknown> = {}) => ({
	id: 1,
	title: 'Clean Code',
	author: 'Robert C. Martin',
	description: 'Un clásico',
	status: 'finished',
	kind: 'tecnico',
	review: null,
	published: true,
	...overrides,
});

beforeEach(() => {
	getJsonMock.mockReset();
	authorizedGetJsonMock.mockReset();
	authorizedPutJsonMock.mockReset();
});

describe('fetchBooksPage — paginated envelope with the published filter', () => {
	it('requests the window with published=true and maps the envelope', async () => {
		getJsonMock.mockResolvedValue({
			items: [row({ id: 2 }), row({ id: 5, status: 'reading' })],
			total: 2,
			offset: 0,
			limit: 4,
		});

		const page = await fetchBooksPage('https://example.test', 0, 4, true);

		expect(getJsonMock).toHaveBeenCalledWith('/books?offset=0&limit=4&published=true', {
			serverOrigin: 'https://example.test',
		});
		expect(page?.total).toBe(2);
		expect(page?.items[0]).toMatchObject({
			id: 2,
			title: 'Clean Code',
			status: 'finished',
			statusLabel: 'Terminado',
			kind: 'tecnico',
			published: true,
		});
	});

	it('adds the kind filter to the window query when the caller sets it', async () => {
		getJsonMock.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 4 });

		await fetchBooksPage('https://example.test', 0, 4, true, 'tecnico');

		expect(getJsonMock).toHaveBeenCalledWith('/books?offset=0&limit=4&published=true&kind=tecnico', {
			serverOrigin: 'https://example.test',
		});
	});

	it('answers null when the read itself fails', async () => {
		getJsonMock.mockRejectedValue(new Error('No se pudo conectar con el servidor.'));
		await expect(fetchBooksPage(undefined, 0, 4, true)).resolves.toBeNull();
	});
});

describe('fetchBooks and fetchMyBooks', () => {
	it('drops unpublished rows from plain public fetchBooks', async () => {
		getJsonMock.mockResolvedValue([row({ id: 1, published: true }), row({ id: 2, published: false })]);
		const books = await fetchBooks();
		expect(books?.map((book) => book.id)).toEqual([1]);
	});

	it('fetchMyBooks calls /books?mine=true with authorization', async () => {
		authorizedGetJsonMock.mockResolvedValue([row({ id: 9, published: false })]);
		const mine = await fetchMyBooks();
		expect(authorizedGetJsonMock).toHaveBeenCalledWith('/books?mine=true');
		expect(mine).toHaveLength(1);
		expect(mine[0].published).toBe(false);
	});
});

describe('multi-user Vigilia reader API helpers', () => {
	it('fetchDemoFeaturedBookId returns the rotating showcase id envelope', async () => {
		getJsonMock.mockResolvedValueOnce({ id: 12 });
		await expect(fetchDemoFeaturedBookId('https://example.test')).resolves.toBe(12);
		expect(getJsonMock).toHaveBeenCalledWith('/books/demo-featured', {
			serverOrigin: 'https://example.test',
		});
	});

	it('fetchDemoFeaturedBookId maps empty shelf and errors to null', async () => {
		getJsonMock.mockResolvedValueOnce({ id: null });
		await expect(fetchDemoFeaturedBookId('https://example.test')).resolves.toBeNull();

		getJsonMock.mockRejectedValueOnce(new Error('boom'));
		await expect(fetchDemoFeaturedBookId('https://example.test')).resolves.toBeNull();
		getJsonMock.mockResolvedValueOnce({ id: 0 });
		await expect(fetchDemoFeaturedBookId(undefined)).resolves.toBeNull();
	});

	it('fetchBookById forwards auth options and preserves owner private books', async () => {
		getJsonMock.mockResolvedValueOnce(row({ id: 8, published: false, isOwner: true, filePath: 'b.pdf' }));
		const book = await fetchBookById(8, {
			serverOrigin: 'https://example.test',
			bearerToken: 'jwt-owner',
		});

		expect(getJsonMock).toHaveBeenCalledWith('/books/8', {
			serverOrigin: 'https://example.test',
			bearerToken: 'jwt-owner',
		});
		expect(book?.id).toBe(8);
		expect(book?.published).toBe(false);
		expect(book?.isOwner).toBe(true);
		expect(book?.hasFile).toBe(true);
	});

	it('fetchBookClientReading uses authorizedGetJson when canSync=true and plain getJson when canSync=false', async () => {
		const doc = { bookId: '7', pdfPages: 120, ocrPending: false, chunks: [] };
		authorizedGetJsonMock.mockResolvedValueOnce(doc);
		await expect(fetchBookClientReading(7, true)).resolves.toEqual(doc);
		expect(authorizedGetJsonMock).toHaveBeenCalledWith('/books/7/reading');

		getJsonMock.mockResolvedValueOnce(doc);
		await expect(fetchBookClientReading(7, false)).resolves.toEqual(doc);
		expect(getJsonMock).toHaveBeenCalledWith('/books/7/reading');
	});

	it('fetches reading.json and reading-state and saves reading-state via PUT', async () => {
		const doc = { bookId: '7', pdfPages: 312, ocrPending: false, chunks: [] };
		getJsonMock.mockResolvedValueOnce(doc);
		await expect(fetchBookReading(7, { serverOrigin: 'https://example.test', bearerToken: 'jwt-1' })).resolves.toEqual(doc);

		const state = { bookId: '7', marks: [], words: [{ term: 'relevos' }], progress: { page: 118, pct: 38 } };
		getJsonMock.mockResolvedValueOnce(state);
		await expect(fetchBookReadingState(7, { serverOrigin: 'https://example.test', cookie: 's=1' })).resolves.toEqual(state);

		authorizedPutJsonMock.mockResolvedValueOnce();
		await saveBookReadingState(7, { progress: { page: 120, pct: 40 } });
		expect(authorizedPutJsonMock).toHaveBeenCalledWith('/books/7/reading-state', {
			progress: { page: 120, pct: 40 },
		});
	});
});
