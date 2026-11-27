const DIALOGUE_DASH_RE = /^\s*(?:—|–|--)\s*[A-ZÁÉÍÓÚÜÑ¿¡«"“‘']/;
const DIALOGUE_QUOTED_SPEECH_RE =
	/^\s*[«"“‘'][^»"”’'\n]{2,}[»"”’'](?:\s*[—–,-]|\s+(?:dijo|exclam[oó]|pregunt[oó]|respondi[oó]|replic[oó]|murmur[oó]|grit[oó]|susurr[oó]|añadi[oó]|agreg[oó]|pens[oó]|contest[oó]|interrumpi[oó]|asked|said|replied|exclaimed|whispered|shouted|thought)(?=\s|[.,;:!?—–]|$))/i;
const CODE_SYNTAX_RE =
	/(?:=>|\b(?:const|let|var|function|return|import|export|class|interface|struct|def|fn|pub|void|int|printf|#include|#define)\b|[{};]\s*$)/m;

/**
 * Detects spoken literary dialogue (em-dash turns or quoted speech with a speech verb)
 * so both new extractions and legacy cached chunks render with readable dialogue styling.
 */
export function isDialogueText(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.length < 4) return false;
	if (CODE_SYNTAX_RE.test(trimmed)) return false;
	return DIALOGUE_DASH_RE.test(trimmed) || DIALOGUE_QUOTED_SPEECH_RE.test(trimmed);
}

/**
 * Returns true when a legacy `code` chunk is actually natural-language prose
 * rather than source code.
 */
export function looksLikeSpokenProse(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.length < 20) return false;
	if (CODE_SYNTAX_RE.test(trimmed)) return false;
	const hasLiteraryPunct = /[¿¡—«»“”]/.test(trimmed);
	const words = trimmed.split(/\s+/).length;
	return words >= 6 && (hasLiteraryPunct || /[áéíóúüñÁÉÍÓÚÜÑ]/.test(trimmed));
}
