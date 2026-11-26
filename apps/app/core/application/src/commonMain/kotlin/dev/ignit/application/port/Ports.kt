// core/application: outbound ports. Pure interfaces — adapters/driven implement them.
package dev.ignit.application.port

import dev.ignit.domain.model.BookPage
import dev.ignit.domain.model.UserSession

/** Outbound port: fetches one page of the catalog (`mine = false`) or of the caller's own library from the remote catalog. */
interface LibraryRepository {
	suspend fun fetchLibrary(
		mine: Boolean = false,
		kind: String? = null,
		limit: Int = DEFAULT_PAGE_SIZE,
		offset: Int = 0,
	): BookPage

	companion object {
		/** Entries per request when the caller does not ask for another page size. */
		const val DEFAULT_PAGE_SIZE: Int = 12

		/**
		 * Rejects a page request no catalog could answer coherently: a page of zero entries, or a
		 * page starting before the first entry. It throws instead of clamping, because every caller
		 * builds these values itself — a bad one is a programming error, not user input, and silently
		 * turning it into `limit = 1` would hide it.
		 */
		fun requireValidRequest(limit: Int, offset: Int) {
			require(limit > 0) { "limit must be positive, was $limit" }
			require(offset >= 0) { "offset must not be negative, was $offset" }
		}
	}
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

/**
 * Outbound port: a small key-value store for user preferences that are not secrets.
 * Secrets go through AuthSession; this is for choices the user can re-make (palette, reader font).
 */
interface Preferences {
	suspend fun read(key: String): String?
	suspend fun write(key: String, value: String)
}
