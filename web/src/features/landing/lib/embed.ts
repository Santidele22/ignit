import type { Book } from '../../../entities/book/types';
import { isReaderRoute } from '../../auth/paths';

/**
 * Validates and normalizes an input URL or book ID for the Section IV live
 * Vigilia iframe embed. Only same-origin `/lecturas/:id` paths are permitted;
 * external origins, non-http(s) schemes, and non-reader routes are rejected.
 */
export function resolveSafeReaderEmbedPath(
	rawInput: string,
	currentOrigin: string,
): string | null {
	const trimmed = rawInput.trim();
	if (!trimmed) return null;

	// Allow shorthand numeric book IDs like "4"
	if (/^\d+$/.test(trimmed)) {
		return `/lecturas/${trimmed}`;
	}

	// Reject protocol-relative URLs and backslashes immediately
	if (trimmed.startsWith('//') || trimmed.includes('\\')) {
		return null;
	}

	// Direct relative path
	if (trimmed.startsWith('/')) {
		const pathOnly = trimmed.split(/[?#]/, 1)[0] ?? '';
		if (!isReaderRoute(pathOnly)) return null;
		return pathOnly.replace(/\/+$/, '');
	}

	// Full URL: must be http(s) and strictly same-origin
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return null;
		}
		if (parsed.origin !== currentOrigin) {
			return null;
		}
		if (!isReaderRoute(parsed.pathname)) {
			return null;
		}
		return parsed.pathname.replace(/\/+$/, '');
	} catch {
		return null;
	}
}

export function defaultEmbedPath(books: readonly Pick<Book, 'id' | 'published'>[]): string | null {
	const firstPublished = books.find((b) => b.published);
	return firstPublished ? `/lecturas/${firstPublished.id}` : null;
}
