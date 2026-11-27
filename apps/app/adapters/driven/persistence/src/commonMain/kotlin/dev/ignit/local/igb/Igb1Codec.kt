package dev.ignit.local.igb

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

const val IGB1_VERSION: Byte = 1
const val IGB1_HEADER_BYTES = 18
const val IGB1_NONCE_BYTES = 12
const val IGB1_GCM_TAG_BYTES = 16
const val IGB1_KEY_BYTES = 32

const val IGB1_FLAG_BROTLI: Int = 1 shl 0
const val IGB1_FLAG_ENCRYPTED: Int = 1 shl 1
const val IGB1_FLAG_CHUNKED: Int = 1 shl 2

enum class ContentTier(val wireName: String) {
    PUBLIC_OPEN("public_open"),
    PRIVATE_USER("private_user"),
    EDITORIAL_CLOSED("editorial_closed");

    companion object {
        fun fromWire(value: String): ContentTier =
            entries.firstOrNull { it.wireName == value }
                ?: throw IllegalArgumentException("Unknown ContentTier: $value")
    }
}

data class ReadingInlineRun(
    val text: String,
    val marks: List<String>? = null,
)

data class ReadingChunk(
    val id: String,
    val type: String,
    val page: Int,
    val offset: Int,
    val text: String,
    val mood: String = "espera",
    val cues: List<String> = emptyList(),
    val level: Int? = null,
    val runs: List<ReadingInlineRun>? = null,
    val ordered: Boolean? = null,
    val items: List<String>? = null,
    val align: String = "left",
)

data class BookReadingDocument(
    val bookId: String,
    val pdfPages: Int,
    val ocrPending: Boolean,
    val extractorVersion: Int? = null,
    val refinedByAi: Boolean? = null,
    val chunks: List<ReadingChunk>,
)

expect object Igb1PlatformCrypto {
    fun gzipCompress(data: ByteArray): ByteArray
    fun gzipDecompress(data: ByteArray): ByteArray
    fun aesGcmEncrypt(plaintext: ByteArray, key: ByteArray, iv: ByteArray, aad: ByteArray): ByteArray
    fun aesGcmDecrypt(ciphertextWithTag: ByteArray, key: ByteArray, iv: ByteArray, aad: ByteArray): ByteArray
    fun randomNonce(size: Int): ByteArray
}

object Igb1Codec {
    private val magic = byteArrayOf(0x49, 0x47, 0x42, 0x31) // "IGB1"
    private val json = Json { ignoreUnknownKeys = true }

    fun buildAad(bookId: String, version: Int, tier: ContentTier): ByteArray =
        "$bookId|$version|${tier.wireName}".encodeToByteArray()

    fun encode(
        doc: BookReadingDocument,
        bookId: String,
        tier: ContentTier,
        key: ByteArray? = null,
        iv: ByteArray? = null,
    ): ByteArray {
        val encrypted = tier != ContentTier.PUBLIC_OPEN
        if (encrypted) {
            require(key != null && key.size == IGB1_KEY_BYTES) {
                "IGB1 encryption requires a 32-byte AES-256 key"
            }
        }
        val nonce = if (encrypted) {
            iv ?: Igb1PlatformCrypto.randomNonce(IGB1_NONCE_BYTES)
        } else {
            ByteArray(IGB1_NONCE_BYTES)
        }
        require(nonce.size == IGB1_NONCE_BYTES) { "IV must be 12 bytes" }

        val compactJson = compactToJson(doc).toString().encodeToByteArray()
        val compressed = Igb1PlatformCrypto.gzipCompress(compactJson)
        val flags = (if (encrypted) IGB1_FLAG_ENCRYPTED else 0).toByte()

        val body = if (!encrypted) {
            compressed
        } else {
            val aad = buildAad(bookId, IGB1_VERSION.toInt(), tier)
            Igb1PlatformCrypto.aesGcmEncrypt(compressed, key!!, nonce, aad)
        }

        val out = ByteArray(IGB1_HEADER_BYTES + body.size)
        magic.copyInto(out, 0)
        out[4] = IGB1_VERSION
        out[5] = flags
        nonce.copyInto(out, 6)
        body.copyInto(out, IGB1_HEADER_BYTES)
        return out
    }

    fun decode(
        bytes: ByteArray,
        bookId: String,
        tier: ContentTier,
        key: ByteArray? = null,
    ): BookReadingDocument {
        require(bytes.size >= IGB1_HEADER_BYTES) { "Invalid IGB1 buffer: too short" }
        for (i in 0 until 4) {
            require(bytes[i] == magic[i]) { "Invalid IGB1 magic" }
        }
        val version = bytes[4].toInt() and 0xff
        require(version == IGB1_VERSION.toInt()) { "Unsupported IGB1 version: $version" }

        val flags = bytes[5].toInt() and 0xff
        val useBrotli = (flags and IGB1_FLAG_BROTLI) != 0
        require(!useBrotli) { "Brotli IGB1 payloads are not enabled on JVM/Android stdlib codec; use gzip" }
        val encrypted = (flags and IGB1_FLAG_ENCRYPTED) != 0
        val nonce = bytes.copyOfRange(6, IGB1_HEADER_BYTES)
        val body = bytes.copyOfRange(IGB1_HEADER_BYTES, bytes.size)

        val compressed = if (!encrypted) {
            body
        } else {
            require(key != null && key.size == IGB1_KEY_BYTES) {
                "IGB1 decryption requires a 32-byte AES-256 key"
            }
            require(body.size >= IGB1_GCM_TAG_BYTES) { "Invalid encrypted IGB1 buffer: missing GCM tag" }
            val aad = buildAad(bookId, version, tier)
            Igb1PlatformCrypto.aesGcmDecrypt(body, key, nonce, aad)
        }

        val decompressed = Igb1PlatformCrypto.gzipDecompress(compressed).decodeToString()
        val obj = json.parseToJsonElement(decompressed).jsonObject
        return expandFromJson(obj)
    }

    private fun compactToJson(doc: BookReadingDocument): JsonObject = buildJsonObject {
        put("v", 1)
        put("b", doc.bookId)
        put("p", doc.pdfPages)
        if (doc.ocrPending) put("o", 1)
        doc.extractorVersion?.let { put("ev", it) }
        if (doc.refinedByAi == true) put("ai", 1)
        put(
            "c",
            buildJsonArray {
                for (ch in doc.chunks) {
                    add(
                        buildJsonObject {
                            put("i", ch.id)
                            if (ch.type != "para") put("t", ch.type)
                            put("p", ch.page)
                            put("o", ch.offset)
                            put("x", ch.text)
                            if (ch.mood != "espera") put("m", ch.mood)
                            if (ch.cues.isNotEmpty()) {
                                put("q", JsonArray(ch.cues.map(::JsonPrimitive)))
                            }
                            ch.level?.let { put("l", it) }
                            if (!ch.runs.isNullOrEmpty()) {
                                put(
                                    "r",
                                    buildJsonArray {
                                        for (run in ch.runs) {
                                            add(
                                                buildJsonObject {
                                                    put("text", run.text)
                                                    if (!run.marks.isNullOrEmpty()) {
                                                        put("marks", JsonArray(run.marks.map(::JsonPrimitive)))
                                                    }
                                                },
                                            )
                                        }
                                    },
                                )
                            }
                            if (ch.ordered == true) put("ord", 1)
                            if (!ch.items.isNullOrEmpty()) {
                                put("it", JsonArray(ch.items.map(::JsonPrimitive)))
                            }
                            if (ch.align == "center" || ch.align == "right") put("a", ch.align)
                        },
                    )
                }
            },
        )
    }

    fun expandFromJson(obj: JsonObject): BookReadingDocument {
        val version = obj["v"]?.jsonPrimitive?.int ?: 0
        require(version == 1) { "Unsupported CompactReadingDocument version: $version" }
        val chunks = obj["c"]?.jsonArray.orEmpty().map { el ->
            val c = el.jsonObject
            ReadingChunk(
                id = c.getValue("i").jsonPrimitive.content,
                type = c["t"]?.jsonPrimitive?.content ?: "para",
                page = c.getValue("p").jsonPrimitive.int,
                offset = c.getValue("o").jsonPrimitive.int,
                text = c.getValue("x").jsonPrimitive.content,
                mood = c["m"]?.jsonPrimitive?.content ?: "espera",
                cues = c["q"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList(),
                level = c["l"]?.jsonPrimitive?.int,
                runs = c["r"]?.jsonArray?.map { rEl ->
                    val rObj = rEl.jsonObject
                    ReadingInlineRun(
                        text = rObj.getValue("text").jsonPrimitive.content,
                        marks = rObj["marks"]?.jsonArray?.map { it.jsonPrimitive.content },
                    )
                },
                ordered = if (c["ord"]?.jsonPrimitive?.int == 1) true else null,
                items = c["it"]?.jsonArray?.map { it.jsonPrimitive.content },
                align = c["a"]?.jsonPrimitive?.content ?: "left",
            )
        }
        return BookReadingDocument(
            bookId = obj.getValue("b").jsonPrimitive.content,
            pdfPages = obj.getValue("p").jsonPrimitive.int,
            ocrPending = obj["o"]?.jsonPrimitive?.int == 1,
            extractorVersion = obj["ev"]?.jsonPrimitive?.int,
            refinedByAi = if (obj["ai"]?.jsonPrimitive?.int == 1) true else null,
            chunks = chunks,
        )
    }

    fun parseExpectedDocument(obj: JsonObject): BookReadingDocument {
        val chunks = obj["chunks"]?.jsonArray.orEmpty().map { el ->
            val c = el.jsonObject
            ReadingChunk(
                id = c.getValue("id").jsonPrimitive.content,
                type = c.getValue("type").jsonPrimitive.content,
                page = c.getValue("page").jsonPrimitive.int,
                offset = c.getValue("offset").jsonPrimitive.int,
                text = c.getValue("text").jsonPrimitive.content,
                mood = c["mood"]?.jsonPrimitive?.content ?: "espera",
                cues = c["cues"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList(),
                level = c["level"]?.jsonPrimitive?.int,
                runs = c["runs"]?.jsonArray?.map { rEl ->
                    val rObj = rEl.jsonObject
                    ReadingInlineRun(
                        text = rObj.getValue("text").jsonPrimitive.content,
                        marks = rObj["marks"]?.jsonArray?.map { it.jsonPrimitive.content },
                    )
                },
                ordered = c["ordered"]?.jsonPrimitive?.booleanOrNull,
                items = c["items"]?.jsonArray?.map { it.jsonPrimitive.content },
                align = c["align"]?.jsonPrimitive?.content ?: "left",
            )
        }
        return BookReadingDocument(
            bookId = obj.getValue("bookId").jsonPrimitive.content,
            pdfPages = obj.getValue("pdfPages").jsonPrimitive.int,
            ocrPending = obj["ocrPending"]?.jsonPrimitive?.booleanOrNull ?: false,
            extractorVersion = obj["extractorVersion"]?.jsonPrimitive?.int,
            refinedByAi = obj["refinedByAi"]?.jsonPrimitive?.booleanOrNull,
            chunks = chunks,
        )
    }
}
