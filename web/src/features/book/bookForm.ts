import type { BookKind, ReadingStatus } from '../../entities/book/types';
import type { AdminBookRow, BookWriteBody } from './api/books-admin';

export type BookFormState = {
	title: string;
	author: string;
	description: string;
	/** Reading status key; the DTO requires it, so it always has a value. */
	status: string;
	/** Landing shelf key; the DTO accepts it optionally, the form always sends it. */
	kind: string;
	review: string;
	published: boolean;
	coverUrl?: string;
	publisher?: string;
	translator?: string;
	illustrator?: string;
	isbn?: string;
	license?: string;
	ctaLabel?: string;
	ctaUrl?: string;
};

export const EMPTY_BOOK_FORM: BookFormState = {
	title: '',
	author: '',
	description: '',
	status: 'reading',
	kind: 'no_tecnico',
	review: '',
	published: false,
	publisher: '',
	translator: '',
	illustrator: '',
	isbn: '',
	license: '',
	ctaLabel: '',
	ctaUrl: '',
};

export const BOOK_STATUS_OPTIONS: { value: ReadingStatus; label: string }[] = [
	{ value: 'reading', label: 'Leyendo' },
	{ value: 'finished', label: 'Terminado' },
	{ value: 'queued', label: 'En cola' },
];

export const BOOK_KIND_OPTIONS: { value: BookKind; label: string }[] = [
	{ value: 'tecnico', label: 'Técnico' },
	{ value: 'no_tecnico', label: 'No técnico' },
];

const STATUS_KEYS: string[] = BOOK_STATUS_OPTIONS.map((option) => option.value);
const KIND_KEYS: string[] = BOOK_KIND_OPTIONS.map((option) => option.value);

/** Rendered label of a stored kind key; defaults to `No técnico`. */
export function bookKindLabel(kind: string | null | undefined): string {
	return BOOK_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? 'No técnico';
}

/** Rendered label of a stored status key; unknown keys fall back to their raw value. */
export function bookStatusLabel(status: string): string {
	return BOOK_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

/** Maps a stored book row into editable form fields. */
export function bookToForm(row: AdminBookRow): BookFormState {
	return {
		title: row.title,
		author: row.author,
		description: row.description,
		status: row.status ?? 'reading',
		kind: row.kind ?? 'no_tecnico',
		review: row.review ?? '',
		published: row.published === true,
		...(row.coverUrl ? { coverUrl: row.coverUrl } : {}),
		...(row.publisher ? { publisher: row.publisher } : {}),
		...(row.translator ? { translator: row.translator } : {}),
		...(row.illustrator ? { illustrator: row.illustrator } : {}),
		...(row.isbn ? { isbn: row.isbn } : {}),
		...(row.license ? { license: row.license } : {}),
		...(row.ctaLabel ? { ctaLabel: row.ctaLabel } : {}),
		...(row.ctaUrl ? { ctaUrl: row.ctaUrl } : {}),
	};
}

/** Maps form state into the API write payload. */
export function bookFormToBody(form: BookFormState): BookWriteBody {
	const cleanCover = form.coverUrl?.trim();
	const optionalText = (value: string | undefined): string | null | undefined =>
		value === undefined ? undefined : value.trim() || null;

	return {
		title: form.title.trim(),
		author: form.author.trim(),
		description: form.description.trim(),
		status: STATUS_KEYS.includes(form.status) ? (form.status as ReadingStatus) : 'reading',
		kind: KIND_KEYS.includes(form.kind) ? (form.kind as BookKind) : 'no_tecnico',
		review: form.review.trim() || null,
		published: form.published,
		// An untouched cover field stays out of the payload; an explicitly
		// cleared one (`''` after `Quitar`) writes `null` so editing can undo a
		// previously stored cover instead of silently keeping it.
		...(form.coverUrl === undefined ? {} : { coverUrl: cleanCover || null }),
		...(form.publisher === undefined ? {} : { publisher: optionalText(form.publisher) }),
		...(form.translator === undefined ? {} : { translator: optionalText(form.translator) }),
		...(form.illustrator === undefined ? {} : { illustrator: optionalText(form.illustrator) }),
		...(form.isbn === undefined ? {} : { isbn: optionalText(form.isbn) }),
		...(form.license === undefined ? {} : { license: optionalText(form.license) }),
		...(form.ctaLabel === undefined ? {} : { ctaLabel: optionalText(form.ctaLabel) }),
		...(form.ctaUrl === undefined ? {} : { ctaUrl: optionalText(form.ctaUrl) }),
	};
}

/** Client-side check so the admin gets Spanish copy instead of a raw `400`. */
export function validateBookForm(form: BookFormState): string | null {
	if (!form.title.trim()) return 'El libro necesita un título.';
	if (!form.author.trim()) return 'El libro necesita un autor.';
	if (!form.description.trim()) return 'El libro necesita una descripción.';
	const ctaUrl = form.ctaUrl?.trim();
	if (ctaUrl && !/^https?:\/\//i.test(ctaUrl)) {
		return 'El enlace externo debe comenzar con http:// o https://.';
	}

	return null;
}

/** Formats an uploaded `bigint` byte size string into a human-readable label. */
export function formatBookFileSize(size: string | null | undefined): string | null {
	if (!size) return null;

	const bytes = Number(size);
	if (!Number.isFinite(bytes) || bytes <= 0) return null;

	const units = ['B', 'KB', 'MB', 'GB'];
	let value = bytes;
	let unit = 0;

	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}

	return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
