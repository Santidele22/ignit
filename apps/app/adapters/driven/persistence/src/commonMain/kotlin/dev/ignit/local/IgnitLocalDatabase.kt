package dev.ignit.local

import dev.ignit.local.igb.BookReadingDocument
import dev.ignit.local.igb.ContentTier
import dev.ignit.local.igb.Igb1Codec

/**
 * Canonical 5-table SQLite schema shared with Desktop (Tauri/rusqlite)
 * so PC and Android maintain identical local-first tables.
 */
const val IGNIT_LOCAL_SCHEMA_SQL: String = """
CREATE TABLE IF NOT EXISTS local_books (
    id TEXT PRIMARY KEY,
    remote_id INTEGER,
    content_hash TEXT,
    content_tier TEXT NOT NULL DEFAULT 'private_user',
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'no_tecnico',
    status TEXT NOT NULL DEFAULT 'queued',
    igb_local_path TEXT,
    igb_bytes INTEGER,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS local_reading_states (
    book_id TEXT PRIMARY KEY,
    page INTEGER NOT NULL DEFAULT 1,
    pct REAL NOT NULL DEFAULT 0.0,
    chunk_id TEXT,
    marks_json TEXT NOT NULL DEFAULT '[]',
    words_json TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS local_licenses (
    book_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    wrapped_key TEXT NOT NULL,
    expires_at INTEGER,
    revoked_at INTEGER,
    PRIMARY KEY (book_id, device_id)
);

CREATE TABLE IF NOT EXISTS sync_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    op TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);

CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

data class LocalBookRecord(
    val id: String,
    val remoteId: Long? = null,
    val contentHash: String? = null,
    val contentTier: String = "private_user",
    val title: String,
    val author: String,
    val kind: String = "no_tecnico",
    val status: String = "queued",
    val igbLocalPath: String? = null,
    val igbBytes: Long? = null,
    val updatedAt: Long,
    val deletedAt: Long? = null,
)

data class LocalReadingStateRecord(
    val bookId: String,
    val page: Int,
    val pct: Double,
    val chunkId: String? = null,
    val marksJson: String = "[]",
    val wordsJson: String = "[]",
    val updatedAt: Long,
)

data class LocalLicenseRecord(
    val bookId: String,
    val deviceId: String,
    val wrappedKey: String,
    val expiresAt: Long? = null,
    val revokedAt: Long? = null,
)

data class SyncOutboxRecord(
    val id: Long,
    val entityType: String,
    val entityId: String,
    val op: String,
    val payloadJson: String,
    val createdAt: Long,
    val retryCount: Int = 0,
    val lastError: String? = null,
)

/** Last-Write-Wins conflict resolution for reading progress across devices. */
fun resolveProgressConflict(
    local: LocalReadingStateRecord?,
    remote: LocalReadingStateRecord?,
): LocalReadingStateRecord? {
    if (local == null) return remote
    if (remote == null) return local
    return if (local.updatedAt > remote.updatedAt) local else remote
}

interface IgnitLocalStore {
    fun upsertBook(book: LocalBookRecord)
    fun listBooks(): List<LocalBookRecord>
    fun getBook(id: String): LocalBookRecord?
    fun softDeleteBook(id: String, deletedAt: Long)

    fun upsertReadingState(state: LocalReadingStateRecord)
    fun getReadingState(bookId: String): LocalReadingStateRecord?

    fun upsertLicense(license: LocalLicenseRecord)
    fun getLicense(bookId: String, deviceId: String): LocalLicenseRecord?

    fun enqueueOutbox(
        entityType: String,
        entityId: String,
        op: String,
        payloadJson: String,
        createdAt: Long,
    ): Long

    fun listPendingOutbox(limit: Int = 50): List<SyncOutboxRecord>
    fun markOutboxDone(id: Long)
    fun markOutboxRetry(id: Long, error: String)

    fun getMeta(key: String): String?
    fun setMeta(key: String, value: String)
}

interface IgbBlobStore {
    fun saveIgb(bookId: String, bytes: ByteArray): String
    fun readIgb(bookId: String): ByteArray?
    fun deleteIgb(bookId: String): Boolean

    fun readDecoded(
        bookId: String,
        tier: ContentTier,
        key: ByteArray? = null,
    ): BookReadingDocument? {
        val raw = readIgb(bookId) ?: return null
        return Igb1Codec.decode(raw, bookId, tier, key)
    }
}

class InMemoryIgnitLocalStore : IgnitLocalStore {
    private val books = linkedMapOf<String, LocalBookRecord>()
    private val states = linkedMapOf<String, LocalReadingStateRecord>()
    private val licenses = linkedMapOf<Pair<String, String>, LocalLicenseRecord>()
    private val outbox = mutableListOf<SyncOutboxRecord>()
    private val meta = linkedMapOf<String, String>()
    private var nextOutboxId = 1L

    override fun upsertBook(book: LocalBookRecord) {
        val existing = books[book.id]
        books[book.id] = book.copy(
            igbLocalPath = book.igbLocalPath ?: existing?.igbLocalPath,
            igbBytes = book.igbBytes ?: existing?.igbBytes,
        )
    }

    override fun listBooks(): List<LocalBookRecord> =
        books.values.filter { it.deletedAt == null }.sortedByDescending { it.updatedAt }

    override fun getBook(id: String): LocalBookRecord? = books[id]

    override fun softDeleteBook(id: String, deletedAt: Long) {
        val existing = books[id] ?: return
        books[id] = existing.copy(deletedAt = deletedAt, updatedAt = deletedAt)
    }

    override fun upsertReadingState(state: LocalReadingStateRecord) {
        states[state.bookId] = state
    }

    override fun getReadingState(bookId: String): LocalReadingStateRecord? = states[bookId]

    override fun upsertLicense(license: LocalLicenseRecord) {
        licenses[license.bookId to license.deviceId] = license
    }

    override fun getLicense(bookId: String, deviceId: String): LocalLicenseRecord? =
        licenses[bookId to deviceId]

    override fun enqueueOutbox(
        entityType: String,
        entityId: String,
        op: String,
        payloadJson: String,
        createdAt: Long,
    ): Long {
        val id = nextOutboxId++
        outbox.add(
            SyncOutboxRecord(
                id = id,
                entityType = entityType,
                entityId = entityId,
                op = op,
                payloadJson = payloadJson,
                createdAt = createdAt,
            ),
        )
        return id
    }

    override fun listPendingOutbox(limit: Int): List<SyncOutboxRecord> = outbox.take(limit)

    override fun markOutboxDone(id: Long) {
        outbox.removeAll { it.id == id }
    }

    override fun markOutboxRetry(id: Long, error: String) {
        val idx = outbox.indexOfFirst { it.id == id }
        if (idx >= 0) {
            val cur = outbox[idx]
            outbox[idx] = cur.copy(retryCount = cur.retryCount + 1, lastError = error)
        }
    }

    override fun getMeta(key: String): String? = meta[key]

    override fun setMeta(key: String, value: String) {
        meta[key] = value
    }
}
