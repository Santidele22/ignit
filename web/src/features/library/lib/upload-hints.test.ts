import { describe, expect, it } from 'vitest';
import { pdfNameHints } from './upload-hints';

describe('pdf name hints (upload prefill)', () => {
	it('splits a classic "Title – Author" filename', () => {
		expect(pdfNameHints('El elogio de la sombra – Junichiro Tanizaki.pdf')).toEqual({
			title: 'El elogio de la sombra',
			author: 'Junichiro Tanizaki',
		});
		// Also em dash, hyphen and underscore variants.
		expect(pdfNameHints('Rayuela—Julio Cortázar.pdf')).toEqual({
			title: 'Rayuela',
			author: 'Julio Cortázar',
		});
		expect(pdfNameHints('Pedro Paramo - Juan Rulfo.pdf')).toEqual({
			title: 'Pedro Paramo',
			author: 'Juan Rulfo',
		});
		expect(pdfNameHints('Introduccion_a_la_algoritmica.pdf')).toEqual({
			title: 'Introduccion a la algoritmica',
			author: null,
		});
	});

	it('cleans download-site noise from the title', () => {
		expect(pdfNameHints('El Aleph - Jorge Luis Borges [z-lib.org].pdf')).toEqual({
			title: 'El Aleph',
			author: 'Jorge Luis Borges',
		});
		expect(pdfNameHints('Data Intensive Applications (www.ebooksbrasil.com).pdf')).toEqual({
			title: 'Data Intensive Applications',
			author: null,
		});
	});

	it('strips the extension and trims, never invents data', () => {
		const hints = pdfNameHints('documento.pdf');
		expect(hints).toEqual({ title: 'documento', author: null });

		// Files without a usable name produce nothing at all.
		expect(pdfNameHints('  .pdf')).toEqual({ title: null, author: null });
		expect(pdfNameHints('')).toEqual({ title: null, author: null });
	});
});
