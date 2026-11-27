package dev.ignit.domain.model

data class ReadingProgress(
	val bookId: String,
	val page: Int,
	val pct: Double = 0.0,
	val chunkId: String? = null,
	val updatedAtEpochMs: Long = 0L,
) {
	init {
		require(bookId.isNotBlank()) { "bookId must not be blank" }
		require(page >= 1) { "page must be >= 1, was $page" }
		require(pct in 0.0..1.0) { "pct must be in 0.0..1.0, was $pct" }
	}
}

data class DomainReadingChunk(
	val id: String,
	val type: String,
	val page: Int,
	val offset: Int,
	val text: String,
	val mood: String = "espera",
	val level: Int? = null,
	val align: String = "left",
)

data class DomainReadingDocument(
	val bookId: String,
	val pdfPages: Int,
	val ocrPending: Boolean = false,
	val chunks: List<DomainReadingChunk>,
)

/** Last-Write-Wins conflict resolution: newer [updatedAtEpochMs] wins; ties prefer remote. */
fun resolveProgressConflict(
	local: ReadingProgress?,
	remote: ReadingProgress?,
): ReadingProgress? {
	if (local == null) return remote
	if (remote == null) return local
	return if (local.updatedAtEpochMs > remote.updatedAtEpochMs) local else remote
}
