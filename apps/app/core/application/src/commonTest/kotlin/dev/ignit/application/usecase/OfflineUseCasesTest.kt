package dev.ignit.application.usecase

import dev.ignit.application.port.ProgressRepository
import dev.ignit.application.port.ReadingContentGateway
import dev.ignit.domain.model.DomainReadingChunk
import dev.ignit.domain.model.DomainReadingDocument
import dev.ignit.domain.model.ReadingProgress
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class OfflineUseCasesTest {
	@Test
	fun downloadsChecksAndRemovesOfflineBook() = runTest {
		val cache = mutableMapOf<String, DomainReadingDocument>()
		val repo = object : ProgressRepository {
			override suspend fun saveLocally(bookId: String, page: Int) {}
			override suspend fun syncPending(): Boolean = true
			override suspend fun getCachedDocument(bookId: String): DomainReadingDocument? = cache[bookId]
			override suspend fun cacheDocument(document: DomainReadingDocument) {
				cache[document.bookId] = document
			}
			override suspend fun deleteCachedDocument(bookId: String): Boolean =
				cache.remove(bookId) != null
		}
		val gateway = object : ReadingContentGateway {
			override suspend fun fetchReading(bookId: String): DomainReadingDocument = DomainReadingDocument(
				bookId = bookId,
				pdfPages = 3,
				chunks = listOf(DomainReadingChunk("c1", "para", 1, 0, "Texto offline")),
			)
			override suspend fun fetchRemoteProgress(bookId: String): ReadingProgress? = null
			override suspend fun pushRemoteProgress(progress: ReadingProgress) {}
		}

		val isOffline = IsBookAvailableOffline(repo)
		assertFalse(isOffline("42"))

		DownloadBookOffline(gateway, repo)("42")
		assertTrue(isOffline("42"))

		assertTrue(RemoveOfflineBook(repo)("42"))
		assertFalse(isOffline("42"))
	}
}
