/**
 * Object-storage keys of the per-book JSON sidecars. Kept in one module so the
 * read, write and delete paths cannot drift apart.
 */
export const readingJsonKey = (bookId: number | string): string =>
  `reading/${bookId}/reading.json`;

export const readingDeterministicJsonKey = (bookId: number | string): string =>
  `reading/${bookId}/reading.deterministic.json`;

export const readingStateKey = (bookId: number | string): string =>
  `reading/${bookId}/state.json`;

export const firewallJsonKey = (bookId: number | string): string =>
  `reading/${bookId}/firewall.json`;
