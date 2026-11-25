import { describe, expect, it, vi } from 'vitest';
import { bookFormToBody, bookToForm, EMPTY_BOOK_FORM, validateBookForm } from './bookForm';

const { getJsonMock, postJsonReturningMock } = vi.hoisted(() => ({
	getJsonMock: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 20 })),
	postJsonReturningMock: vi.fn(async () => ({ id: 42, published: false })),
}));

vi.mock('../../shared/api/authorizedHttp', () => ({
	getJson: getJsonMock,
	postJsonReturning: postJsonReturningMock,
}));

describe('Etapa 1 — Ficha del libro y CTA externo (bookForm & admin-api)', () => {
	it('maps editorial and CTA fields between AdminBookRow and BookFormState', () => {
		const form = bookToForm({
			id: 1,
			title: 'Ficciones',
			author: 'Jorge Luis Borges',
			description: 'Relatos breves.',
			status: 'queued',
			kind: 'no_tecnico',
			published: true,
			publisher: 'Editorial Sur',
			translator: 'N/A',
			illustrator: 'Norah Borges',
			isbn: '978-987-0000-00-0',
			license: 'Autorización editorial',
			ctaLabel: 'Comprar libro físico',
			ctaUrl: 'https://editorial.test/ficciones',
		});

		expect(form).toMatchObject({
			publisher: 'Editorial Sur',
			translator: 'N/A',
			illustrator: 'Norah Borges',
			isbn: '978-987-0000-00-0',
			license: 'Autorización editorial',
			ctaLabel: 'Comprar libro físico',
			ctaUrl: 'https://editorial.test/ficciones',
		});

		const body = bookFormToBody({
			...form,
			publisher: '  Editorial Sur  ',
			translator: '   ',
		});

		expect(body).toMatchObject({
			publisher: 'Editorial Sur',
			translator: null,
			illustrator: 'Norah Borges',
			isbn: '978-987-0000-00-0',
			license: 'Autorización editorial',
			ctaLabel: 'Comprar libro físico',
			ctaUrl: 'https://editorial.test/ficciones',
		});
	});

	it('rejects non-http(s) external CTA URLs', () => {
		const invalid = validateBookForm({
			...EMPTY_BOOK_FORM,
			title: 'Libro',
			author: 'Autor',
			description: 'Desc',
			ctaUrl: 'javascript:alert(1)',
		});
		expect(invalid).toContain('http:// o https://');

		const valid = validateBookForm({
			...EMPTY_BOOK_FORM,
			title: 'Libro',
			author: 'Autor',
			description: 'Desc',
			ctaUrl: 'https://cafecito.app/editorial',
		});
		expect(valid).toBeNull();
	});

	it('sends published=true and unpublish payloads from admin-api', async () => {
		const { fetchAdminQueue, unpublishAdminBook } = await import('../admin/lib/admin-api');

		await fetchAdminQueue({ published: true, page: 1, pageSize: 10 });
		expect(getJsonMock).toHaveBeenCalledWith('/admin/books?published=true&page=1&pageSize=10');

		await unpublishAdminBook(42, '  Pedido de editorial  ');
		expect(postJsonReturningMock).toHaveBeenCalledWith('/admin/books/42/unpublish', {
			note: 'Pedido de editorial',
		});
	});

	it('blocks non-http(s) protocols in safeExternalUrl', async () => {
		const { safeExternalUrl } = await import('./api/books');
		expect(safeExternalUrl('javascript:alert(1)')).toBeUndefined();
		expect(safeExternalUrl('data:text/html,<script>alert(1)</script>')).toBeUndefined();
		expect(safeExternalUrl('not-a-url')).toBeUndefined();
		expect(safeExternalUrl('https://editorial.test/libro')).toBe('https://editorial.test/libro');
		expect(safeExternalUrl('http://cafecito.app/autor')).toBe('http://cafecito.app/autor');
	});
});
