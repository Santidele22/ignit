package dev.ignit.local

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.io.File

class AndroidSqliteLocalStore(context: Context) :
    SQLiteOpenHelper(context, "ignit-local.sqlite", null, 1),
    IgnitLocalStore {

    override fun onCreate(db: SQLiteDatabase) {
        for (stmt in IGNIT_LOCAL_SCHEMA_SQL.split(';')) {
            val trimmed = stmt.trim()
            if (trimmed.isNotEmpty()) {
                db.execSQL(trimmed)
            }
        }
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        onCreate(db)
    }

    override fun upsertBook(book: LocalBookRecord) {
        writableDatabase.execSQL(
            """
            INSERT INTO local_books (
                id, remote_id, content_hash, content_tier, title, author,
                kind, status, igb_local_path, igb_bytes, updated_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                remote_id = excluded.remote_id,
                content_hash = excluded.content_hash,
                content_tier = excluded.content_tier,
                title = excluded.title,
                author = excluded.author,
                kind = excluded.kind,
                status = excluded.status,
                igb_local_path = COALESCE(excluded.igb_local_path, local_books.igb_local_path),
                igb_bytes = COALESCE(excluded.igb_bytes, local_books.igb_bytes),
                updated_at = excluded.updated_at,
                deleted_at = excluded.deleted_at
            """.trimIndent(),
            arrayOf<Any?>(
                book.id,
                book.remoteId,
                book.contentHash,
                book.contentTier,
                book.title,
                book.author,
                book.kind,
                book.status,
                book.igbLocalPath,
                book.igbBytes,
                book.updatedAt,
                book.deletedAt,
            ),
        )
    }

    override fun listBooks(): List<LocalBookRecord> {
        val result = mutableListOf<LocalBookRecord>()
        readableDatabase.rawQuery(
            """
            SELECT id, remote_id, content_hash, content_tier, title, author,
                   kind, status, igb_local_path, igb_bytes, updated_at, deleted_at
            FROM local_books
            WHERE deleted_at IS NULL
            ORDER BY updated_at DESC
            """.trimIndent(),
            emptyArray(),
        ).use { c ->
            while (c.moveToNext()) {
                result.add(
                    LocalBookRecord(
                        id = c.getString(0),
                        remoteId = if (c.isNull(1)) null else c.getLong(1),
                        contentHash = if (c.isNull(2)) null else c.getString(2),
                        contentTier = c.getString(3),
                        title = c.getString(4),
                        author = c.getString(5),
                        kind = c.getString(6),
                        status = c.getString(7),
                        igbLocalPath = if (c.isNull(8)) null else c.getString(8),
                        igbBytes = if (c.isNull(9)) null else c.getLong(9),
                        updatedAt = c.getLong(10),
                        deletedAt = if (c.isNull(11)) null else c.getLong(11),
                    ),
                )
            }
        }
        return result
    }

    override fun getBook(id: String): LocalBookRecord? =
        listBooks().firstOrNull { it.id == id }

    override fun softDeleteBook(id: String, deletedAt: Long) {
        writableDatabase.execSQL(
            "UPDATE local_books SET deleted_at = ?, updated_at = ? WHERE id = ?",
            arrayOf<Any>(deletedAt, deletedAt, id),
        )
    }

    override fun upsertReadingState(state: LocalReadingStateRecord) {
        writableDatabase.execSQL(
            """
            INSERT INTO local_reading_states (
                book_id, page, pct, chunk_id, marks_json, words_json, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(book_id) DO UPDATE SET
                page = excluded.page,
                pct = excluded.pct,
                chunk_id = excluded.chunk_id,
                marks_json = excluded.marks_json,
                words_json = excluded.words_json,
                updated_at = excluded.updated_at
            """.trimIndent(),
            arrayOf<Any?>(
                state.bookId,
                state.page,
                state.pct,
                state.chunkId,
                state.marksJson,
                state.wordsJson,
                state.updatedAt,
            ),
        )
    }

    override fun getReadingState(bookId: String): LocalReadingStateRecord? {
        readableDatabase.rawQuery(
            """
            SELECT book_id, page, pct, chunk_id, marks_json, words_json, updated_at
            FROM local_reading_states WHERE book_id = ?
            """.trimIndent(),
            arrayOf(bookId),
        ).use { c ->
            if (!c.moveToFirst()) return null
            return LocalReadingStateRecord(
                bookId = c.getString(0),
                page = c.getInt(1),
                pct = c.getDouble(2),
                chunkId = if (c.isNull(3)) null else c.getString(3),
                marksJson = c.getString(4),
                wordsJson = c.getString(5),
                updatedAt = c.getLong(6),
            )
        }
    }

    override fun upsertLicense(license: LocalLicenseRecord) {
        writableDatabase.execSQL(
            """
            INSERT INTO local_licenses (
                book_id, device_id, wrapped_key, expires_at, revoked_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(book_id, device_id) DO UPDATE SET
                wrapped_key = excluded.wrapped_key,
                expires_at = excluded.expires_at,
                revoked_at = excluded.revoked_at
            """.trimIndent(),
            arrayOf<Any?>(
                license.bookId,
                license.deviceId,
                license.wrappedKey,
                license.expiresAt,
                license.revokedAt,
            ),
        )
    }

    override fun getLicense(bookId: String, deviceId: String): LocalLicenseRecord? {
        readableDatabase.rawQuery(
            """
            SELECT book_id, device_id, wrapped_key, expires_at, revoked_at
            FROM local_licenses WHERE book_id = ? AND device_id = ?
            """.trimIndent(),
            arrayOf(bookId, deviceId),
        ).use { c ->
            if (!c.moveToFirst()) return null
            return LocalLicenseRecord(
                bookId = c.getString(0),
                deviceId = c.getString(1),
                wrappedKey = c.getString(2),
                expiresAt = if (c.isNull(3)) null else c.getLong(3),
                revokedAt = if (c.isNull(4)) null else c.getLong(4),
            )
        }
    }

    override fun enqueueOutbox(
        entityType: String,
        entityId: String,
        op: String,
        payloadJson: String,
        createdAt: Long,
    ): Long {
        val values = ContentValues().apply {
            put("entity_type", entityType)
            put("entity_id", entityId)
            put("op", op)
            put("payload_json", payloadJson)
            put("created_at", createdAt)
        }
        return writableDatabase.insertOrThrow("sync_outbox", null, values)
    }

    override fun listPendingOutbox(limit: Int): List<SyncOutboxRecord> {
        val result = mutableListOf<SyncOutboxRecord>()
        readableDatabase.rawQuery(
            """
            SELECT id, entity_type, entity_id, op, payload_json, created_at, retry_count, last_error
            FROM sync_outbox ORDER BY id ASC LIMIT ?
            """.trimIndent(),
            arrayOf(limit.toString()),
        ).use { c ->
            while (c.moveToNext()) {
                result.add(
                    SyncOutboxRecord(
                        id = c.getLong(0),
                        entityType = c.getString(1),
                        entityId = c.getString(2),
                        op = c.getString(3),
                        payloadJson = c.getString(4),
                        createdAt = c.getLong(5),
                        retryCount = c.getInt(6),
                        lastError = if (c.isNull(7)) null else c.getString(7),
                    ),
                )
            }
        }
        return result
    }

    override fun markOutboxDone(id: Long) {
        writableDatabase.delete("sync_outbox", "id = ?", arrayOf(id.toString()))
    }

    override fun markOutboxRetry(id: Long, error: String) {
        writableDatabase.execSQL(
            "UPDATE sync_outbox SET retry_count = retry_count + 1, last_error = ? WHERE id = ?",
            arrayOf<Any>(error, id),
        )
    }

    override fun getMeta(key: String): String? {
        readableDatabase.rawQuery(
            "SELECT value FROM sync_meta WHERE key = ?",
            arrayOf(key),
        ).use { c ->
            return if (c.moveToFirst()) c.getString(0) else null
        }
    }

    override fun setMeta(key: String, value: String) {
        writableDatabase.execSQL(
            """
            INSERT INTO sync_meta (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """.trimIndent(),
            arrayOf<Any>(key, value),
        )
    }
}

class AndroidIgbFileStore(private val baseDir: File) : IgbBlobStore {
    private fun safeFile(bookId: String): File {
        require(bookId.isNotEmpty() && bookId.all { it.isLetterOrDigit() || it == '-' || it == '_' }) {
            "Invalid bookId: $bookId"
        }
        return File(baseDir, "$bookId.igb")
    }

    override fun saveIgb(bookId: String, bytes: ByteArray): String {
        baseDir.mkdirs()
        val file = safeFile(bookId)
        file.writeBytes(bytes)
        return file.absolutePath
    }

    override fun readIgb(bookId: String): ByteArray? {
        val file = safeFile(bookId)
        return if (file.exists()) file.readBytes() else null
    }

    override fun deleteIgb(bookId: String): Boolean {
        val file = safeFile(bookId)
        return file.exists() && file.delete()
    }
}
