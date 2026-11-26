// core/application: use case. Orchestrates ports; knows nothing about Ktor/DB/UI.
package dev.ignit.application.usecase

import dev.ignit.application.port.LibraryRepository
import dev.ignit.domain.model.BookPage

/**
 * Loads one page of the catalog ([mine] = false) or of the signed-in user's own library
 * ([mine] = true), optionally narrowed to one [kind] shelf.
 *
 * A blank [kind] means "every shelf", so it is dropped before the port could send `?kind=`.
 * [limit] and [offset] are forwarded verbatim after [LibraryRepository.requireValidRequest]
 * refuses an impossible page; that refusal lands in the returned failure like any other error,
 * so this use case never throws on a bad request.
 */
class SyncLibrary(private val library: LibraryRepository) {
	suspend operator fun invoke(
		mine: Boolean = false,
		kind: String? = null,
		limit: Int = LibraryRepository.DEFAULT_PAGE_SIZE,
		offset: Int = 0,
	): Result<BookPage> = runCatching {
		LibraryRepository.requireValidRequest(limit, offset)
		library.fetchLibrary(
			mine = mine,
			kind = kind?.takeIf { it.isNotBlank() },
			limit = limit,
			offset = offset,
		)
	}
}
