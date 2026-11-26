// core/domain: entities and rules. Pure Kotlin — no framework imports reach this source set.
package dev.ignit.domain.model

/**
 * One page of the catalog plus the total the server reports.
 *
 * [items] are the entries this page carries, [total] is how many entries the whole result holds,
 * [offset] is where this page started and [limit] is how many entries were asked for. The backend
 * answers this shape when the request carries `limit`/`offset`; when it ignores them it sends a
 * bare array instead and the adapter synthesizes a coherent page.
 */
data class BookPage(
	val items: List<Book>,
	val total: Int,
	val offset: Int,
	val limit: Int,
) {
	/** True while the server holds entries past the last one on this page. */
	val hasMore: Boolean get() = offset + items.size < total
}
