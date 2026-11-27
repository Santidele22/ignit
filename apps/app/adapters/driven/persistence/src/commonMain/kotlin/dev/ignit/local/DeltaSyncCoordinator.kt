package dev.ignit.local

data class SyncPushAck(
    val clientOpId: String,
    val status: String, // "applied" | "ignored_stale" | "rejected"
    val remoteId: Long? = null,
    val uploadUrl: String? = null,
)

data class SyncPulledBook(
    val id: Long,
    val title: String,
    val author: String,
    val kind: String,
    val status: String,
    val contentTier: String,
    val contentHash: String? = null,
    val igbPath: String? = null,
    val igbSize: Long? = null,
    val igbBytes: ByteArray? = null,
    val updatedAt: Long,
    val deletedAt: Long? = null,
)

data class SyncPulledReadingState(
    val bookId: Long,
    val page: Int,
    val pct: Double,
    val chunkId: String? = null,
    val marksJson: String = "[]",
    val wordsJson: String = "[]",
    val updatedAt: Long,
)

data class SyncPullPayload(
    val serverTime: Long,
    val books: List<SyncPulledBook>,
    val readingStates: List<SyncPulledReadingState>,
)

interface DeltaSyncTransport {
    fun push(items: List<SyncOutboxRecord>): List<SyncPushAck>
    fun pull(sinceEpochMs: Long): SyncPullPayload
}

class DeltaSyncCoordinator(
    private val store: IgnitLocalStore,
    private val blobStore: IgbBlobStore,
    private val transport: DeltaSyncTransport,
) {
    fun syncOnce(): Long {
        val pending = store.listPendingOutbox(100)
        if (pending.isNotEmpty()) {
            try {
                val acks = transport.push(pending)
                for ((idx, ack) in acks.withIndex()) {
                    val record = pending.getOrNull(idx) ?: continue
                    if (ack.status == "applied" || ack.status == "ignored_stale") {
                        store.markOutboxDone(record.id)
                    } else {
                        store.markOutboxRetry(record.id, ack.status)
                    }
                }
            } catch (err: Throwable) {
                for (record in pending) {
                    store.markOutboxRetry(record.id, err.message ?: "sync error")
                }
                throw err
            }
        }

        val since = store.getMeta("last_sync_at")?.toLongOrNull() ?: 0L
        val pulled = transport.pull(since)

        for (b in pulled.books) {
            val localId = b.id.toString()
            if (b.deletedAt != null) {
                store.softDeleteBook(localId, b.deletedAt)
                blobStore.deleteIgb(localId)
                continue
            }
            val savedPath = b.igbBytes?.let { blobStore.saveIgb(localId, it) }
            store.upsertBook(
                LocalBookRecord(
                    id = localId,
                    remoteId = b.id,
                    contentHash = b.contentHash,
                    contentTier = b.contentTier,
                    title = b.title,
                    author = b.author,
                    kind = b.kind,
                    status = b.status,
                    igbLocalPath = savedPath,
                    igbBytes = b.igbSize,
                    updatedAt = b.updatedAt,
                ),
            )
        }

        for (s in pulled.readingStates) {
            val localId = s.bookId.toString()
            val remote = LocalReadingStateRecord(
                bookId = localId,
                page = s.page,
                pct = s.pct,
                chunkId = s.chunkId,
                marksJson = s.marksJson,
                wordsJson = s.wordsJson,
                updatedAt = s.updatedAt,
            )
            val resolved = resolveProgressConflict(store.getReadingState(localId), remote)
            if (resolved != null) {
                store.upsertReadingState(resolved)
            }
        }

        store.setMeta("last_sync_at", pulled.serverTime.toString())
        return pulled.serverTime
    }
}
