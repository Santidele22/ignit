// core/domain: entities and rules. Pure Kotlin — no framework imports reach this source set.
package dev.ignit.domain.model

/**
 * One catalog entry, mirroring what `GET /api/books` presents: `id`, `title`, `author`,
 * `kind`, `coverUrl` and `published` are the server's own field names.
 *
 * [kind] is the landing shelf and production carries several values (`tecnico`, `terror_scifi`,
 * `filosofia`, `ficcion`, `poesia`), so callers must not assume a fixed pair. [coverUrl] is
 * optional, so the UI can render a clean placeholder. [totalPages] comes from the payload's
 * `filePages`; [roomId] has no backend counterpart yet and keeps its empty default.
 */
data class Book(
	val id: String,
	val title: String,
	val roomId: String,
	val totalPages: Int,
	val author: String = "",
	val kind: String = "",
	val coverUrl: String? = null,
	val published: Boolean = false,
)
