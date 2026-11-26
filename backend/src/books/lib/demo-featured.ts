/**
 * Demo featured book selection ("la estantería" rotating showcase).
 *
 * An anonymous visitor may read exactly one book without an account: the
 * featured showcase title. The feature rotates deterministically so a deleted
 * or unpublished book never leaves a dead link for long — a stale slot simply
 * points at the next rotating entry. Logged-in users are unlimited.
 */

/** The showcase advances by one step every hour. */
export const DEMO_FEATURED_ROTATION_MS = 60 * 60 * 1000;

/** Cap the pool scan so a large catalog cannot degrade every SSR request. */
export const DEMO_FEATURED_POOL_LIMIT = 200;

export function pickDemoFeaturedBookId(
	bookIds: number[],
	nowMs: number = Date.now(),
): number | null {
	if (bookIds.length === 0) {
		return null;
	}
	const slot = Math.floor(nowMs / DEMO_FEATURED_ROTATION_MS);
	return bookIds[slot % bookIds.length]!;
}
