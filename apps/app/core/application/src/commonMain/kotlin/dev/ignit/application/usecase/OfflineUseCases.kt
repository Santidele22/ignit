package dev.ignit.application.usecase

import dev.ignit.application.port.ProgressRepository
import dev.ignit.application.port.ReadingContentGateway

class DownloadBookOffline(
	private val readingGateway: ReadingContentGateway,
	private val progressRepository: ProgressRepository,
) {
	suspend operator fun invoke(bookId: String) {
		val doc = readingGateway.fetchReading(bookId)
		progressRepository.cacheDocument(doc)
	}
}

class RemoveOfflineBook(
	private val progressRepository: ProgressRepository,
) {
	suspend operator fun invoke(bookId: String): Boolean =
		progressRepository.deleteCachedDocument(bookId)
}

class IsBookAvailableOffline(
	private val progressRepository: ProgressRepository,
) {
	suspend operator fun invoke(bookId: String): Boolean =
		progressRepository.getCachedDocument(bookId) != null
}
