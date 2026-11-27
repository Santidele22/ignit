package dev.ignit.application.usecase

import dev.ignit.application.port.ProgressRepository
import dev.ignit.application.port.ReadingContentGateway
import dev.ignit.domain.model.DomainReadingChunk
import dev.ignit.domain.model.DomainReadingDocument
import dev.ignit.domain.model.ReadingProgress
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ReaderUseCasesTest {
	@Test
	fun openBookReadingUsesCacheAndResolvesProgressWithLww() = runTest {
		val cachedDoc = DomainReadingDocument(
			bookId = "7",
			pdfPages = 10,
			chunks = listOf(DomainReadingChunk(id = "c1", type = "para", page = 1, offset = 0, text = "Hola")),
		)
		var gatewayFetchCalls = 0
		val localProgress = ReadingProgress(bookId = "7", page = 6, pct = 0.6, updatedAtEpochMs = 500L)
		val remoteProgress = ReadingProgress(bookId = "7", page = 3, pct = 0.3, updatedAtEpochMs = 200L)

		val repo = object : ProgressRepository {
			override suspend fun saveLocally(bookId: String, page: Int) {}
			override suspend fun syncPending(): Boolean = true
			override suspend fun getLocal(bookId: String): ReadingProgress = localProgress
			override suspend fun getCachedDocument(bookId: String): DomainReadingDocument = cachedDoc
		}
		val gateway = object : ReadingContentGateway {
			override suspend fun fetchReading(bookId: String): DomainReadingDocument {
				gatewayFetchCalls++
				return cachedDoc
			}
			override suspend fun fetchRemoteProgress(bookId: String): ReadingProgress = remoteProgress
			override suspend fun pushRemoteProgress(progress: ReadingProgress) {}
		}

		val opened = OpenBookReading(gateway, repo)("7")
		assertEquals(0, gatewayFetchCalls)
		assertEquals(cachedDoc, opened.document)
		assertEquals(6, opened.progress.page)
	}

	@Test
	fun saveAndSyncReadingProgressPushesLocalToGateway() = runTest {
		var saved: ReadingProgress? = null
		var pushed: ReadingProgress? = null
		val repo = object : ProgressRepository {
			override suspend fun saveLocally(bookId: String, page: Int) {}
			override suspend fun syncPending(): Boolean = true
			override suspend fun getLocal(bookId: String): ReadingProgress? = saved
			override suspend fun saveProgress(progress: ReadingProgress) {
				saved = progress
			}
		}
		val gateway = object : ReadingContentGateway {
			override suspend fun fetchReading(bookId: String): DomainReadingDocument = error("unused")
			override suspend fun fetchRemoteProgress(bookId: String): ReadingProgress? = null
			override suspend fun pushRemoteProgress(progress: ReadingProgress) {
				pushed = progress
			}
		}

		val p = ReadingProgress(bookId = "9", page = 14, pct = 0.5, updatedAtEpochMs = 999L)
		SaveReadingProgress(repo)(p)
		val synced = SyncReadingProgress(gateway, repo)("9")
		assertTrue(synced)
		assertEquals(p, pushed)
	}
}
