// core/application: outbound ports. Pure interfaces — adapters/driven implement them.
package dev.ignit.application.port

import dev.ignit.domain.model.Book

/** Outbound port: fetches the user's library from the remote catalog. */
interface LibraryRepository {
	suspend fun fetchLibrary(): List<Book>
}

/** Outbound port: persists reading progress locally and syncs it remotely. */
interface ProgressRepository {
	suspend fun saveLocally(bookId: String, page: Int)
	suspend fun syncPending(): Boolean
}
