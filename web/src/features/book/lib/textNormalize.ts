// Shared text normalization used by the TOC, noise and display passes.

const DOMAIN_PAGE_WATERMARK_INLINE_EDGE_RE =
	/(?:^\s*(?:(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\s*[-–—|·/]\s*(?:p[aá]gina|page|p[aá]g\.?)\s*\d+(?:\s*(?:de|of|\/)\s*\d+)?|(?:p[aá]gina|page|p[aá]g\.?)\s*\d+(?:\s*(?:de|of|\/)\s*\d+)?\s*[-–—|·/]\s*(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+)\s+|\s+(?:(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\s*[-–—|·/]\s*(?:p[aá]gina|page|p[aá]g\.?)\s*\d+(?:\s*(?:de|of|\/)\s*\d+)?|(?:p[aá]gina|page|p[aá]g\.?)\s*\d+(?:\s*(?:de|of|\/)\s*\d+)?\s*[-–—|·/]\s*(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+)\s*$)/gi;

const PRINT_PDF_URL_LEADING_RE =
	/^\s*(?:https?:\/\/|www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S+(?:\s+\d{1,4}\/\d{1,4})?(?:\s+|$)/i;
const PRINT_PDF_URL_TRAILING_RE =
	/(?:\s+|^)(?:https?:\/\/|www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S+(?:\s+\d{1,4}\/\d{1,4})?\s*$/i;
const LEADING_PAGE_FRACTION_RE = /^\s*\d{1,4}\/\d{1,4}\s+(?=[a-záéíóúüñ,;:])/;

export function normalizeLoose(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

export function stripInlineArtifacts(text: string): string {
	let cleaned = text.trim();
	if (!cleaned) return '';

	for (let i = 0; i < 3; i++) {
		const next = cleaned
			.replace(DOMAIN_PAGE_WATERMARK_INLINE_EDGE_RE, ' ')
			.replace(PRINT_PDF_URL_LEADING_RE, '')
			.replace(PRINT_PDF_URL_TRAILING_RE, '')
			.replace(LEADING_PAGE_FRACTION_RE, '')
			.replace(/\s+https?:\/\/(?:www\.)?(?:lelibros|lectulandia|ebookelo|epublibre|bajalibros|elejandria|espaebook|quedelibros|epubgratis|librodot)[^\s]*$/i, '')
			.replace(/^https?:\/\/(?:www\.)?(?:lelibros|lectulandia|ebookelo|epublibre|bajalibros|elejandria|espaebook|quedelibros|epubgratis|librodot)[^\s]*\s+/i, '')
			.replace(/\s+/g, ' ')
			.trim();
		if (next === cleaned) break;
		cleaned = next;
	}
	return cleaned;
}
