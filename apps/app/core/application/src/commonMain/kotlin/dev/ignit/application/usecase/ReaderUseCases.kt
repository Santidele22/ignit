package dev.ignit.application.usecase

import dev.ignit.application.port.ProgressRepository
import dev.ignit.application.port.ReadingContentGateway
import dev.ignit.domain.model.DomainReadingDocument
import dev.ignit.domain.model.ReadingProgress
import dev.ignit.domain.model.resolveProgressConflict

data class OpenedBookReading(
	val document: DomainReadingDocument,
	val progress: ReadingProgress,
)

class OpenBookReading(
	private val readingGateway: ReadingContentGateway,
	private val progressRepository: ProgressRepository,
) {
	suspend operator fun invoke(bookId: String): OpenedBookReading {
		require(bookId.isNotBlank()) { "bookId must not be blank" }
		val cached = progressRepository.getCachedDocument(bookId)
		val document = cached ?: readingGateway.fetchReading(bookId).also {
			progressRepository.cacheDocument(it)
		}

		val local = progressRepository.getLocal(bookId)
		val remote = runCatching { readingGateway.fetchRemoteProgress(bookId) }.getOrNull()
		val resolved = resolveProgressConflict(local, remote)
			?: ReadingProgress(bookId = bookId, page = 1, pct = 0.0, updatedAtEpochMs = 0L)

		return OpenedBookReading(document = document, progress = resolved)
	}
}

class SaveReadingProgress(
	private val progressRepository: ProgressRepository,
) {
	suspend operator fun invoke(progress: ReadingProgress) {
		progressRepository.saveProgress(progress)
	}
}

class SyncReadingProgress(
	private val readingGateway: ReadingContentGateway,
	private val progressRepository: ProgressRepository,
) {
	suspend operator fun invoke(bookId: String): Boolean {
		val local = progressRepository.getLocal(bookId) ?: return true
		readingGateway.pushRemoteProgress(local)
		return progressRepository.syncPending()
	}
}
