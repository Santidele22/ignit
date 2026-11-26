// core/application: use case. Orchestrates ports; knows nothing about Ktor/DB/UI.
package dev.ignit.application.usecase

import dev.ignit.application.port.LibraryRepository
import dev.ignit.domain.model.Book

/**
 * Loads the catalog ([mine] = false) or the signed-in user's own library ([mine] = true),
 * optionally narrowed to one [kind] shelf.
 *
 * A blank [kind] means "every shelf", so it is dropped before the port could send `?kind=`.
 */
class SyncLibrary(private val library: LibraryRepository) {
	suspend operator fun invoke(mine: Boolean = false, kind: String? = null): Result<List<Book>> =
		runCatching { library.fetchLibrary(mine = mine, kind = kind?.takeIf { it.isNotBlank() }) }
}
