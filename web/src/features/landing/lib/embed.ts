import type { Book } from '../../../entities/book/types';
import { isReaderRoute } from '../../auth/paths';

const POSITIVE_INT_RE = /^[1-9]\d*$/;
const ENCODED_DOT_SEGMENT_RE = /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i;

/**
 * Validates and normalizes an input URL or book ID for the Section IV live
 * Vigilia iframe embed. Only same-origin `/lecturas/:id` paths are permitted;
 * external origins, non-http(s) schemes, dot-segment traversal (raw or
 * percent-encoded), non-positive IDs, and non-reader routes are rejected.
 */
export function resolveSafeReaderEmbedPath(
	rawInput: string,
	currentOrigin: string,
): string | null {
	const trimmed = rawInput.trim();
	if (!trimmed) return null;

	// Allow shorthand positive integer book IDs like "4" (reject "0", "-1")
	if (/^-?\d+$/.test(trimmed)) {
		return POSITIVE_INT_RE.test(trimmed) ? `/lecturas/${trimmed}` : null;
	}

	// Reject protocol-relative URLs and backslashes immediately
	if (trimmed.startsWith('//') || trimmed.includes('\\')) {
		return null;
	}

	let parsed: URL;
	try {
		parsed = trimmed.startsWith('/')
			? new URL(trimmed, currentOrigin)
			: new URL(trimmed);
	} catch {
		return null;
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return null;
	}
	if (parsed.origin !== currentOrigin) {
		return null;
	}

	// Reject raw or percent-encoded dot-segments before and after URL normalization
	const rawPath = trimmed.startsWith('/')
		? trimmed.split(/[?#]/, 1)[0] ?? ''
		: parsed.pathname;
	if (ENCODED_DOT_SEGMENT_RE.test(rawPath) || ENCODED_DOT_SEGMENT_RE.test(parsed.pathname)) {
		return null;
	}

	const normalizedPath = parsed.pathname.replace(/\/+$/, '');
	if (!isReaderRoute(normalizedPath)) {
		return null;
	}

	const rawSegment = normalizedPath.slice('/lecturas/'.length);
	let decodedSegment: string;
	try {
		decodedSegment = decodeURIComponent(rawSegment);
	} catch {
		return null;
	}

	if (
		!decodedSegment ||
		decodedSegment === '.' ||
		decodedSegment === '..' ||
		decodedSegment.includes('/') ||
		decodedSegment.includes('\\')
	) {
		return null;
	}

	if (/^-?\d+$/.test(decodedSegment) && !POSITIVE_INT_RE.test(decodedSegment)) {
		return null;
	}

	return normalizedPath;
}

export function defaultEmbedPath(books: readonly Pick<Book, 'id' | 'published'>[]): string | null {
	const firstPublished = books.find(
		(book) => book.published && Number.isInteger(book.id) && book.id > 0,
	);
	return firstPublished ? `/lecturas/${firstPublished.id}` : null;
}
