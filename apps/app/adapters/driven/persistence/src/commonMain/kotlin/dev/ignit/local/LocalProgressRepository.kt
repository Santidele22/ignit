// Stub persistence adapter: SQLDelight database lands with the offline slice.
package dev.ignit.local

import dev.ignit.application.port.ProgressRepository

class LocalProgressRepository : ProgressRepository {
	private val pending = mutableMapOf<String, Int>()
	override suspend fun saveLocally(bookId: String, page: Int) { pending[bookId] = page }
	override suspend fun syncPending(): Boolean = pending.isEmpty()
}
