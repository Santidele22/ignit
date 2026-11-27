package dev.ignit.local.igb

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.SecureRandom
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

actual object Igb1PlatformCrypto {
    private val random = SecureRandom()

    actual fun gzipCompress(data: ByteArray): ByteArray {
        val baos = ByteArrayOutputStream()
        GZIPOutputStream(baos).use { it.write(data) }
        return baos.toByteArray()
    }

    actual fun gzipDecompress(data: ByteArray): ByteArray {
        GZIPInputStream(ByteArrayInputStream(data)).use { return it.readBytes() }
    }

    actual fun aesGcmEncrypt(
        plaintext: ByteArray,
        key: ByteArray,
        iv: ByteArray,
        aad: ByteArray,
    ): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        cipher.updateAAD(aad)
        return cipher.doFinal(plaintext)
    }

    actual fun aesGcmDecrypt(
        ciphertextWithTag: ByteArray,
        key: ByteArray,
        iv: ByteArray,
        aad: ByteArray,
    ): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        cipher.updateAAD(aad)
        return cipher.doFinal(ciphertextWithTag)
    }

    actual fun randomNonce(size: Int): ByteArray = ByteArray(size).also(random::nextBytes)
}
