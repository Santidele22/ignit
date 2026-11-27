package dev.ignit.local

import dev.ignit.local.igb.BookReadingDocument
import dev.ignit.local.igb.ContentTier
import dev.ignit.local.igb.Igb1Codec
import dev.ignit.local.igb.ReadingChunk
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

private class TempDirIgbBlobStore(private val dir: File) : IgbBlobStore {
    override fun saveIgb(bookId: String, bytes: ByteArray): String {
        dir.mkdirs()
        val file = File(dir, "$bookId.igb")
        file.writeBytes(bytes)
        return file.absolutePath
    }

    override fun readIgb(bookId: String): ByteArray? {
        val file = File(dir, "$bookId.igb")
        return if (file.exists()) file.readBytes() else null
    }

    override fun deleteIgb(bookId: String): Boolean {
        val file = File(dir, "$bookId.igb")
        return file.exists() && file.delete()
    }
}

class IgnitLocalStoreTest {
    @Test
    fun resolvesProgressConflictWithLastWriteWins() {
        val older = LocalReadingStateRecord(bookId = "1", page = 10, pct = 0.1, updatedAt = 100L)
        val newer = LocalReadingStateRecord(bookId = "1", page = 45, pct = 0.45, updatedAt = 200L)

        assertEquals(newer, resolveProgressConflict(older, newer))
        assertEquals(newer, resolveProgressConflict(newer, older))
        assertEquals(older, resolveProgressConflict(older, null))
        assertEquals(newer, resolveProgressConflict(null, newer))
    }

    @Test
    fun crudLocalBooksStatesLicensesOutboxAndMeta() {
        val store = InMemoryIgnitLocalStore()
        store.upsertBook(
            LocalBookRecord(
                id = "b-1",
                remoteId = 10L,
                contentTier = "private_user",
                title = "El Aleph",
                author = "Borges",
                updatedAt = 1000L,
            ),
        )
        assertEquals(1, store.listBooks().size)

        store.upsertReadingState(
            LocalReadingStateRecord(bookId = "b-1", page = 12, pct = 0.2, updatedAt = 1005L),
        )
        assertEquals(12, store.getReadingState("b-1")?.page)

        store.upsertLicense(
            LocalLicenseRecord(bookId = "b-1", deviceId = "android-1", wrappedKey = "wk"),
        )
        assertEquals("wk", store.getLicense("b-1", "android-1")?.wrappedKey)

        val outId = store.enqueueOutbox("reading_state", "b-1", "upsert", "{}", 1005L)
        store.markOutboxRetry(outId, "timeout")
        assertEquals(1, store.listPendingOutbox().first().retryCount)
        store.markOutboxDone(outId)
        assertTrue(store.listPendingOutbox().isEmpty())

        store.setMeta("last_sync_at", "1005")
        assertEquals("1005", store.getMeta("last_sync_at"))

        store.softDeleteBook("b-1", 2000L)
        assertTrue(store.listBooks().isEmpty())
    }

    @Test
    fun savesAndDecodesIgbBlobOffline() {
        val dir = Files.createTempDirectory("ignit-kmp-igb-").toFile()
        try {
            val blobs = TempDirIgbBlobStore(dir)
            val key = ByteArray(32) { 0x33 }
            val iv = ByteArray(12) { 0x07 }
            val doc = BookReadingDocument(
                bookId = "b-99",
                pdfPages = 4,
                ocrPending = false,
                chunks = listOf(
                    ReadingChunk(
                        id = "c-1",
                        type = "para",
                        page = 1,
                        offset = 0,
                        text = "Lectura offline en Android/KMP con IGB1.",
                    ),
                ),
            )

            val encoded = Igb1Codec.encode(doc, "b-99", ContentTier.PRIVATE_USER, key = key, iv = iv)
            blobs.saveIgb("b-99", encoded)

            val decoded = blobs.readDecoded("b-99", ContentTier.PRIVATE_USER, key = key)
            assertEquals(doc, decoded)

            assertTrue(blobs.deleteIgb("b-99"))
            assertNull(blobs.readIgb("b-99"))
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test
    fun deltaSyncCoordinatorFlushesOutboxPullsPrivateIgbAndAppliesLww() {
        val dir = Files.createTempDirectory("ignit-kmp-sync-").toFile()
        try {
            val store = InMemoryIgnitLocalStore()
            val blobs = TempDirIgbBlobStore(dir)
            store.enqueueOutbox("reading_state", "10", "upsert", """{"page":5}""", 100L)

            val key = ByteArray(32) { 0x55 }
            val iv = ByteArray(12) { 0x12 }
            val remoteDoc = BookReadingDocument(
                bookId = "10",
                pdfPages = 2,
                ocrPending = false,
                chunks = listOf(
                    ReadingChunk(id = "c1", type = "para", page = 1, offset = 0, text = "Sync móvil completo."),
                ),
            )
            val igbBytes = Igb1Codec.encode(remoteDoc, "10", ContentTier.PRIVATE_USER, key = key, iv = iv)

            val coordinator = DeltaSyncCoordinator(
                store = store,
                blobStore = blobs,
                transport = object : DeltaSyncTransport {
                    override fun push(items: List<SyncOutboxRecord>): List<SyncPushAck> =
                        items.map { SyncPushAck(clientOpId = it.id.toString(), status = "applied", remoteId = 10L) }

                    override fun pull(sinceEpochMs: Long): SyncPullPayload = SyncPullPayload(
                        serverTime = 500L,
                        books = listOf(
                            SyncPulledBook(
                                id = 10L,
                                title = "Libro Privado",
                                author = "Autor",
                                kind = "ficcion",
                                status = "reading",
                                contentTier = "private_user",
                                igbSize = igbBytes.size.toLong(),
                                igbBytes = igbBytes,
                                updatedAt = 500L,
                            ),
                        ),
                        readingStates = listOf(
                            SyncPulledReadingState(bookId = 10L, page = 18, pct = 0.3, updatedAt = 450L),
                        ),
                    )
                },
            )

            val serverTime = coordinator.syncOnce()
            assertEquals(500L, serverTime)
            assertTrue(store.listPendingOutbox().isEmpty())
            assertEquals("500", store.getMeta("last_sync_at"))
            assertEquals(18, store.getReadingState("10")?.page)
            assertEquals(remoteDoc, blobs.readDecoded("10", ContentTier.PRIVATE_USER, key = key))
        } finally {
            dir.deleteRecursively()
        }
    }
}
