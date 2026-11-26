// core/application: use case. Orchestrates ports; knows nothing about Ktor/DB/UI.
package dev.ignit.application.usecase

import dev.ignit.application.port.LibraryRepository
import dev.ignit.domain.model.Book

class SyncLibrary(private val library: LibraryRepository) {
	suspend operator fun invoke(): Result<List<Book>> = runCatching { library.fetchLibrary() }
}
