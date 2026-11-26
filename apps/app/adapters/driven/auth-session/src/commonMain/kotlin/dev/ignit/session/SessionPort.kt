// Stub session adapter: platform storage comes with the first vertical slice (login).
package dev.ignit.session

interface SessionStore {
	suspend fun token(): String?
	suspend fun save(token: String)
}

class InMemorySessionStore : SessionStore {
	private var current: String? = null
	override suspend fun token(): String? = current
	override suspend fun save(token: String) { current = token }
}
