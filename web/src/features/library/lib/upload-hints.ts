/**
 * Filename → metadata hints for the "Subir libro" modal: uploads usually
 * carry the title (and often the author) in the PDF/EPUB filename, so the modal
 * prefills its empty inputs instead of making the user retype them.
 *
 * Pure and deterministic: it never invents data — anything it cannot clean
 * stays `null` and the field keeps its `Ej. …` placeholder.
 */

/** Common download-site tags that ride at the end of scraped filenames. */
const NOISE_PATTERNS: RegExp[] = [
	/\s*[\[(]\s*(?:z-lib|libgen|pdfdrive|ebook[^)\]]*|www\.[^\s)\]]+|\S+\.com\b)[^\])]*[\])]\s*/gi,
	/\s*{\s*www\.[^}]*}\s*/gi,
];

export type PdfNameHints = {
	title: string | null;
	author: string | null;
};

const TRAILING_YEAR_RE = /(?:\s*[\[(]\s*(?:1[5-9]\d{2}|20\d{2})\s*[\])]|\s+(?:1[5-9]\d{2}|20\d{2}))$/;

function formatAuthorName(raw: string, fromSlug: boolean): string {
	const expanded = raw.replace(/\b([a-zA-Z])\.([a-zA-Z])\./g, '$1. $2.').replace(/\s+/g, ' ').trim();
	if (!fromSlug || expanded !== expanded.toLowerCase()) {
		return expanded;
	}
	return expanded
		.split(' ')
		.map((word) => {
			if (!word) return '';
			if (/^[a-z]\.$/i.test(word)) return word.toUpperCase();
			return word.charAt(0).toUpperCase() + word.slice(1);
		})
		.join(' ');
}

function formatSlugTitle(raw: string, fromSlug: boolean): string {
	const trimmed = raw.trim();
	if (!fromSlug || !trimmed.includes(' ') || trimmed !== trimmed.toLowerCase()) {
		return trimmed;
	}
	return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Derives `{ title, author }` from a filename like
 * `El elogio de la sombra – Junichiro Tanizaki.pdf` (or `.epub`, which strips
 * the same way) or `la-maquina-se-detiene-por-e.m.-forster-1909.pdf`.
 *
 * Recognizes ` – `, ` — `, ` - ` and ` por ` / ` by ` as title/author
 * separators, converts underscores and kebab-case slugs to spaces, strips
 * download-site noise and trailing publication years, and formats slug casing.
 */
export function pdfNameHints(rawFilename: string | null | undefined): PdfNameHints {
	const filename = rawFilename?.trim() ?? '';
	if (!filename) {
		return { title: null, author: null };
	}

	const stem = filename.replace(/\.(?:pdf|epub)$/i, '');
	const noiseStripped = NOISE_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, ' '), stem);
	let spaced = noiseStripped.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

	// Kebab-case slugs (e.g. `la-maquina-se-detiene-por-e.m.-forster-1909`)
	const isKebabSlug = !/\s/.test(spaced) && (spaced.match(/-/g)?.length ?? 0) >= 2;
	if (isKebabSlug) {
		spaced = spaced.replace(/-+/g, ' ').replace(/\s+/g, ' ').trim();
	}

	spaced = spaced.replace(TRAILING_YEAR_RE, '').trim();

	if (!spaced || /^(cpdf|document|new)$/i.test(spaced)) {
		return { title: null, author: null };
	}
	const spacedRaw = spaced;

	// Plain hyphen only splits when surrounded by spaces (an unspaced hyphen
	// is a joiner word, e.g. `Cien-Años`); en/em dashes split either way.
	const spacedSeparator = / [-–—] /.exec(spacedRaw);
	const unspaced = spacedSeparator ? null : /[–—]/.exec(spacedRaw);
	const bySeparator = spacedSeparator || unspaced ? null : /\s+(?:por|by)\s+/i.exec(spacedRaw);
	const separator = spacedSeparator ?? unspaced ?? bySeparator;
	if (separator) {
		const rawTitle = spacedRaw.slice(0, separator.index).trim();
		const rawAuthor = spacedRaw
			.slice(separator.index + separator[0].length)
			.replace(TRAILING_YEAR_RE, '')
			.trim();
		const title = rawTitle ? formatSlugTitle(rawTitle, isKebabSlug) : null;
		const author = rawAuthor ? formatAuthorName(rawAuthor, isKebabSlug) : null;
		return { title, author };
	}

	return { title: formatSlugTitle(spacedRaw, isKebabSlug), author: null };
}

export function pdfNameHintsFile(file: File | { name: string }): PdfNameHints {
	return pdfNameHints(file.name);
}
