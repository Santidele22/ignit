package dev.ignit.local.drm

import dev.ignit.local.igb.Igb1PlatformCrypto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFails
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class EditorialDrmTest {
    @Test
    fun enablesFlagSecureOnlyForTier3EditorialClosed() {
        assertTrue(Tier3ScreenSecurityPolicy.shouldEnableFlagSecure("editorial_closed"))
        assertFalse(Tier3ScreenSecurityPolicy.shouldEnableFlagSecure("private_user"))
        assertFalse(Tier3ScreenSecurityPolicy.shouldEnableFlagSecure("public_open"))
    }

    @Test
    fun decryptsSingleEditorialChapterInRamAndZeroesCek() {
        val cek = ByteArray(32) { 0x6a }
        val iv = ByteArray(12) { 0x15 }
        val payloadJson = """[{"id":"c1","type":"para","page":1,"offset":0,"text":"Capítulo protegido en RAM."}]"""
        val compressed = Igb1PlatformCrypto.gzipCompress(payloadJson.encodeToByteArray())
        val aad = EditorialDrmDecoder.buildChapterAad("700", 0)
        val ct = Igb1PlatformCrypto.aesGcmEncrypt(compressed, cek.copyOf(), iv, aad)

        val chunks = EditorialDrmDecoder.decryptChapter(
            bookId = "700",
            chapterIndex = 0,
            iv = iv,
            ciphertextWithTag = ct,
            cek = cek,
            zeroCekAfter = true,
        )

        assertEquals(1, chunks.size)
        assertEquals("Capítulo protegido en RAM.", chunks[0].text)
        assertTrue(cek.all { it == 0.toByte() })

        // Wrong chapter index AAD must fail
        assertFails {
            EditorialDrmDecoder.decryptChapter(
                bookId = "700",
                chapterIndex = 1,
                iv = iv,
                ciphertextWithTag = ct,
                cek = ByteArray(32) { 0x6a },
            )
        }
    }
}
