/**
 * Filename → metadata hints for the "Subir libro" modal: uploads usually
 * carry the title (and often the author) in the PDF filename, so the modal
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

/**
 * Derives `{ title, author }` from a filename like
 * `El elogio de la sombra – Junichiro Tanizaki.pdf`.
 *
 * Recognizes ` – `, ` — ` and ` - ` as title/author separators (the first
 * of them wins), replaces underscores with spaces and strips download-site
 * noise. A single clean segment becomes the title with no author.
 */
export function pdfNameHints(rawFilename: string | null | undefined): PdfNameHints {
	const filename = rawFilename?.trim() ?? '';
	if (!filename) {
		return { title: null, author: null };
	}

	const stem = filename.replace(/\.pdf$/i, '');
	const noiseStripped = NOISE_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, ' '), stem);
	const spaced = noiseStripped
		.replace(/[_]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	if (!spaced || /^(cpdf|document|new)$/i.test(spaced)) {
		return { title: null, author: null };
	}
	const spacedRaw = spaced;

	// Plain hyphen only splits when surrounded by spaces (an unspaced hyphen
	// is a joiner word, e.g. `Cien-Años`); en/em dashes split either way.
	const spacedSeparator = / [-–—] /.exec(spacedRaw);
	const unspaced = spacedSeparator ? null : /[–—]/.exec(spacedRaw);
	const separator = spacedSeparator ?? unspaced;
	if (separator) {
		const title = spacedRaw.slice(0, separator.index).trim();
		const author = spacedRaw.slice(separator.index + separator[0].length).trim();
		return {
			title: title || null,
			author: author || null,
		};
	}

	return { title: spacedRaw, author: null };
}

export function pdfNameHintsFile(file: File | { name: string }): PdfNameHints {
	return pdfNameHints(file.name);
}
