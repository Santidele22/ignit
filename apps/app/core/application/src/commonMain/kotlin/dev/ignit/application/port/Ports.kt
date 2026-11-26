// core/application: outbound ports. Pure interfaces — adapters/driven implement them.
package dev.ignit.application.port

import dev.ignit.domain.model.Book
import dev.ignit.domain.model.UserSession

/** Outbound port: fetches the user's library from the remote catalog. */
interface LibraryRepository {
	suspend fun fetchLibrary(): List<Book>
}

/** Outbound port: persists reading progress locally and syncs it remotely. */
interface ProgressRepository {
	suspend fun saveLocally(bookId: String, page: Int)
	suspend fun syncPending(): Boolean
}

/**
 * Outbound port: authenticates against the remote backend.
 *
 * Implementations throw [dev.ignit.domain.model.AuthException] carrying the backend's own
 * user-facing message when the credentials are rejected.
 */
interface AuthGateway {
	suspend fun signIn(email: String, password: String): UserSession
}

/** Outbound port: keeps the signed-in session across app launches. */
interface AuthSession {
	suspend fun load(): UserSession?
	suspend fun save(session: UserSession)
	suspend fun clear()
}
