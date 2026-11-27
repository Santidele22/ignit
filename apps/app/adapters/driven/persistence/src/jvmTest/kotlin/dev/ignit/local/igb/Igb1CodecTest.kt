package dev.ignit.local.igb

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFails

class Igb1CodecTest {
    private fun hexToBytes(hex: String): ByteArray =
        ByteArray(hex.length / 2) { i ->
            hex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }

    @Test
    fun decodesCrossPlatformGoldenVectorsFromSpec() {
        val vectorsFile = generateSequence(File(".").absoluteFile) { it.parentFile }
            .map { File(it, "docs/specs/igb1-golden-vectors.json") }
            .firstOrNull { it.exists() }
            ?: error("Could not locate docs/specs/igb1-golden-vectors.json from ${File(".").absolutePath}")

        val root = Json.parseToJsonElement(vectorsFile.readText()).jsonObject
        val vectors = root.getValue("vectors").jsonArray
        var checked = 0

        for (entry in vectors) {
            val obj = entry.jsonObject
            val compression = obj.getValue("compression").jsonPrimitive.content
            if (compression != "gzip") continue

            val bookId = obj.getValue("bookId").jsonPrimitive.content
            val tier = ContentTier.fromWire(obj.getValue("tier").jsonPrimitive.content)
            val key = obj["keyHex"]?.jsonPrimitive?.content?.let(::hexToBytes)
            val bytes = Base64.getDecoder().decode(obj.getValue("igb1Base64").jsonPrimitive.content)
            val expected = Igb1Codec.parseExpectedDocument(obj.getValue("expectedDocument").jsonObject)

            val decoded = Igb1Codec.decode(bytes, bookId, tier, key)
            assertEquals(expected, decoded)
            checked++
        }

        assertEquals(3, checked)
    }

    @Test
    fun roundTripsAes256GcmAndRejectsTamperedAadOrTag() {
        val key = ByteArray(32) { 0x42 }
        val iv = ByteArray(12) { 0x11 }
        val doc = BookReadingDocument(
            bookId = "88",
            pdfPages = 3,
            ocrPending = false,
            extractorVersion = 3,
            refinedByAi = true,
            chunks = listOf(
                ReadingChunk(
                    id = "c-1",
                    type = "para",
                    page = 1,
                    offset = 0,
                    text = "Lectura offline encriptada en Kotlin con javax.crypto AES-256-GCM.",
                ),
            ),
        )

        val encoded = Igb1Codec.encode(doc, "88", ContentTier.PRIVATE_USER, key = key, iv = iv)
        val decoded = Igb1Codec.decode(encoded, "88", ContentTier.PRIVATE_USER, key = key)
        assertEquals(doc, decoded)

        // Wrong bookId in AAD must fail GCM auth
        assertFails {
            Igb1Codec.decode(encoded, "99", ContentTier.PRIVATE_USER, key = key)
        }

        // Tampered GCM tag must fail
        val tampered = encoded.copyOf()
        tampered[tampered.lastIndex] = (tampered[tampered.lastIndex].toInt() xor 0xff).toByte()
        assertFails {
            Igb1Codec.decode(tampered, "88", ContentTier.PRIVATE_USER, key = key)
        }
    }
}
