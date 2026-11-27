package dev.ignit.local

import dev.ignit.application.port.ProgressRepository
import dev.ignit.domain.model.DomainReadingChunk
import dev.ignit.domain.model.DomainReadingDocument
import dev.ignit.domain.model.ReadingProgress
import dev.ignit.local.igb.BookReadingDocument
import dev.ignit.local.igb.ContentTier
import dev.ignit.local.igb.Igb1Codec
import dev.ignit.local.igb.ReadingChunk

/**
 * Local-first ProgressRepository backed by IgnitLocalStore (SQLite on Android,
 * InMemoryIgnitLocalStore on JVM tests) + IGB1 compressed blob cache.
 */
class LocalProgressRepository(
	private val store: IgnitLocalStore = InMemoryIgnitLocalStore(),
	private val blobStore: IgbBlobStore? = null,
) : ProgressRepository {

	override suspend fun saveLocally(bookId: String, page: Int) {
		val existing = store.getReadingState(bookId)
		saveProgress(
			ReadingProgress(
				bookId = bookId,
				page = page.coerceAtLeast(1),
				pct = existing?.pct ?: 0.0,
				chunkId = existing?.chunkId,
				updatedAtEpochMs = System.currentTimeMillis(),
			),
		)
	}

	override suspend fun getLocal(bookId: String): ReadingProgress? {
		val row = store.getReadingState(bookId) ?: return null
		return ReadingProgress(
			bookId = row.bookId,
			page = row.page.coerceAtLeast(1),
			pct = row.pct.coerceIn(0.0, 1.0),
			chunkId = row.chunkId,
			updatedAtEpochMs = row.updatedAt,
		)
	}

	override suspend fun saveProgress(progress: ReadingProgress) {
		val existing = store.getReadingState(progress.bookId)
		store.upsertReadingState(
			LocalReadingStateRecord(
				bookId = progress.bookId,
				page = progress.page,
				pct = progress.pct,
				chunkId = progress.chunkId,
				marksJson = existing?.marksJson ?: "[]",
				wordsJson = existing?.wordsJson ?: "[]",
				updatedAt = progress.updatedAtEpochMs,
			),
		)
		store.enqueueOutbox(
			entityType = "reading_state",
			entityId = progress.bookId,
			op = "upsert",
			payloadJson = """{"page":${progress.page},"pct":${progress.pct}}""",
			createdAt = progress.updatedAtEpochMs,
		)
	}

	override suspend fun syncPending(): Boolean =
		store.listPendingOutbox(1).isEmpty()

	override suspend fun getCachedDocument(bookId: String): DomainReadingDocument? {
		val decoded = blobStore?.readDecoded(bookId, ContentTier.PUBLIC_OPEN) ?: return null
		return DomainReadingDocument(
			bookId = decoded.bookId,
			pdfPages = decoded.pdfPages,
			ocrPending = decoded.ocrPending,
			chunks = decoded.chunks.map { ch ->
				DomainReadingChunk(
					id = ch.id,
					type = ch.type,
					page = ch.page,
					offset = ch.offset,
					text = ch.text,
					mood = ch.mood,
					level = ch.level,
					align = ch.align,
				)
			},
		)
	}

	override suspend fun cacheDocument(document: DomainReadingDocument) {
		val blobs = blobStore ?: return
		val igbDoc = BookReadingDocument(
			bookId = document.bookId,
			pdfPages = document.pdfPages,
			ocrPending = document.ocrPending,
			chunks = document.chunks.map { ch ->
				ReadingChunk(
					id = ch.id,
					type = ch.type,
					page = ch.page,
					offset = ch.offset,
					text = ch.text,
					mood = ch.mood,
					level = ch.level,
					align = ch.align,
				)
			},
		)
		val bytes = Igb1Codec.encode(igbDoc, document.bookId, ContentTier.PUBLIC_OPEN)
		blobs.saveIgb(document.bookId, bytes)
	}

	override suspend fun deleteCachedDocument(bookId: String): Boolean =
		blobStore?.deleteIgb(bookId) ?: false
}
