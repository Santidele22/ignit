package dev.ignit.local.drm

import dev.ignit.local.igb.IGB1_GCM_TAG_BYTES
import dev.ignit.local.igb.IGB1_KEY_BYTES
import dev.ignit.local.igb.IGB1_NONCE_BYTES
import dev.ignit.local.igb.IGB1_VERSION
import dev.ignit.local.igb.Igb1PlatformCrypto
import dev.ignit.local.igb.ReadingChunk
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

object Tier3ScreenSecurityPolicy {
    fun shouldEnableFlagSecure(contentTier: String): Boolean =
        contentTier == "editorial_closed"
}

object EditorialDrmDecoder {
    private val json = Json { ignoreUnknownKeys = true }

    fun buildChapterAad(bookId: String, chapterIndex: Int): ByteArray =
        "$bookId|${IGB1_VERSION.toInt()}|editorial_closed|ch:$chapterIndex".encodeToByteArray()

    fun decryptChapter(
        bookId: String,
        chapterIndex: Int,
        iv: ByteArray,
        ciphertextWithTag: ByteArray,
        cek: ByteArray,
        zeroCekAfter: Boolean = true,
    ): List<ReadingChunk> {
        require(iv.size == IGB1_NONCE_BYTES) { "IV must be 12 bytes" }
        require(cek.size == IGB1_KEY_BYTES) { "CEK must be 32 bytes" }
        require(ciphertextWithTag.size >= IGB1_GCM_TAG_BYTES) { "Missing GCM tag" }

        try {
            val aad = buildChapterAad(bookId, chapterIndex)
            val compressed = Igb1PlatformCrypto.aesGcmDecrypt(ciphertextWithTag, cek, iv, aad)
            val rawJson = Igb1PlatformCrypto.gzipDecompress(compressed).decodeToString()
            return json.parseToJsonElement(rawJson).jsonArray.map { el ->
                val c = el.jsonObject
                ReadingChunk(
                    id = c.getValue("id").jsonPrimitive.content,
                    type = c["type"]?.jsonPrimitive?.content ?: "para",
                    page = c.getValue("page").jsonPrimitive.int,
                    offset = c.getValue("offset").jsonPrimitive.int,
                    text = c.getValue("text").jsonPrimitive.content,
                    mood = c["mood"]?.jsonPrimitive?.content ?: "espera",
                    cues = c["cues"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList(),
                    level = c["level"]?.jsonPrimitive?.int,
                    align = c["align"]?.jsonPrimitive?.content ?: "left",
                )
            }
        } finally {
            if (zeroCekAfter) {
                cek.fill(0)
            }
        }
    }
}
