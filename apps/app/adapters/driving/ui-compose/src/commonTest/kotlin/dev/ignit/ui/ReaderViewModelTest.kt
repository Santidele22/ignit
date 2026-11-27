package dev.ignit.ui

import dev.ignit.application.port.ProgressRepository
import dev.ignit.application.port.ReadingContentGateway
import dev.ignit.application.usecase.OpenBookReading
import dev.ignit.application.usecase.SaveReadingProgress
import dev.ignit.application.usecase.SyncReadingProgress
import dev.ignit.domain.model.Book
import dev.ignit.domain.model.DomainReadingChunk
import dev.ignit.domain.model.DomainReadingDocument
import dev.ignit.domain.model.ReadingProgress
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

class ReaderViewModelTest {
	@Test
	fun opensDocumentRestoresPageAndHandlesOfflineSyncStatus() = runTest {
		var saved: ReadingProgress? = null
		var failRemote = false

		val doc = DomainReadingDocument(
			bookId = "10",
			pdfPages = 3,
			chunks = listOf(
				DomainReadingChunk(id = "c1", type = "heading", page = 1, offset = 0, text = "Cap 1", level = 1),
				DomainReadingChunk(id = "c2", type = "para", page = 2, offset = 20, text = "Página 2"),
				DomainReadingChunk(id = "c3", type = "para", page = 3, offset = 40, text = "Página 3"),
			),
		)

		val repo = object : ProgressRepository {
			override suspend fun saveLocally(bookId: String, page: Int) {}
			override suspend fun syncPending(): Boolean = true
			override suspend fun getLocal(bookId: String): ReadingProgress? = saved
			override suspend fun saveProgress(progress: ReadingProgress) {
				saved = progress
			}
		}

		val gateway = object : ReadingContentGateway {
			override suspend fun fetchReading(bookId: String): DomainReadingDocument = doc
			override suspend fun fetchRemoteProgress(bookId: String): ReadingProgress =
				ReadingProgress(bookId = bookId, page = 2, pct = 0.66, updatedAtEpochMs = 100L)
			override suspend fun pushRemoteProgress(progress: ReadingProgress) {
				if (failRemote) error("offline")
			}
		}

		val vm = ReaderViewModel(
			OpenBookReading(gateway, repo),
			SaveReadingProgress(repo),
			SyncReadingProgress(gateway, repo),
		)

		vm.open(Book(id = "10", title = "Rayuela", roomId = "", totalPages = 3, author = "Cortázar"))
		assertEquals(3, vm.pages.size)
		assertEquals(2, vm.currentPage)
		assertEquals(ReaderSyncStatus.SYNCED, vm.syncStatus)

		failRemote = true
		vm.onPageChanged(3)
		assertEquals(3, vm.currentPage)
		assertEquals(3, saved?.page)
		assertEquals(ReaderSyncStatus.PENDING_OFFLINE, vm.syncStatus)
	}
}
