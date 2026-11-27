package dev.ignit.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.ignit.application.usecase.OpenBookReading
import dev.ignit.application.usecase.SaveReadingProgress
import dev.ignit.application.usecase.SyncReadingProgress
import dev.ignit.domain.model.Book
import dev.ignit.domain.model.DomainReadingChunk
import dev.ignit.domain.model.DomainReadingDocument
import dev.ignit.domain.model.ReadingProgress

enum class ReaderSyncStatus {
	IDLE,
	SAVED_LOCAL,
	SYNCED,
	PENDING_OFFLINE,
}

class ReaderViewModel(
	private val openBookReading: OpenBookReading,
	private val saveReadingProgress: SaveReadingProgress,
	private val syncReadingProgress: SyncReadingProgress,
) {
	var loading: Boolean by mutableStateOf(false)
		private set
	var error: String? by mutableStateOf(null)
		private set
	var book: Book? by mutableStateOf(null)
		private set
	var document: DomainReadingDocument? by mutableStateOf(null)
		private set
	var pages: List<List<DomainReadingChunk>> by mutableStateOf(emptyList())
		private set
	var currentPage: Int by mutableStateOf(1)
		private set
	var vigiliaMode: Boolean by mutableStateOf(true)
		private set
	var syncStatus: ReaderSyncStatus by mutableStateOf(ReaderSyncStatus.IDLE)
		private set

	suspend fun open(target: Book) {
		book = target
		loading = true
		error = null
		try {
			val opened = openBookReading(target.id)
			document = opened.document
			pages = groupChunksByPage(opened.document)
			currentPage = opened.progress.page.coerceIn(1, pages.size.coerceAtLeast(1))
			syncStatus = ReaderSyncStatus.SYNCED
		} catch (err: Throwable) {
			error = err.message ?: "No pudimos abrir el libro."
		} finally {
			loading = false
		}
	}

	suspend fun onPageChanged(newPage: Int) {
		val activeBook = book ?: return
		val total = pages.size.coerceAtLeast(1)
		val clamped = newPage.coerceIn(1, total)
		currentPage = clamped
		val pct = (clamped.toDouble() / total.toDouble()).coerceIn(0.0, 1.0)
		val progress = ReadingProgress(
			bookId = activeBook.id,
			page = clamped,
			pct = pct,
			chunkId = pages.getOrNull(clamped - 1)?.firstOrNull()?.id,
			updatedAtEpochMs = System.currentTimeMillis(),
		)
		saveReadingProgress(progress)
		syncStatus = ReaderSyncStatus.SAVED_LOCAL
		val synced = runCatching { syncReadingProgress(activeBook.id) }.getOrDefault(false)
		syncStatus = if (synced) ReaderSyncStatus.SYNCED else ReaderSyncStatus.PENDING_OFFLINE
	}

	fun toggleVigiliaMode() {
		vigiliaMode = !vigiliaMode
	}

	private fun groupChunksByPage(doc: DomainReadingDocument): List<List<DomainReadingChunk>> {
		if (doc.chunks.isEmpty()) return emptyList()
		val grouped = doc.chunks.groupBy { it.page.coerceAtLeast(1) }
		val maxPage = grouped.keys.maxOrNull() ?: 1
		return (1..maxPage).mapNotNull { pageNum -> grouped[pageNum]?.takeIf { it.isNotEmpty() } }
	}
}
