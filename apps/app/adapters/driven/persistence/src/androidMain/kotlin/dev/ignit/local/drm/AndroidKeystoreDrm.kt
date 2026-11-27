package dev.ignit.local.drm

import android.app.Activity
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.WindowManager
import java.security.KeyPairGenerator
import java.security.KeyStore
import javax.crypto.Cipher

object AndroidKeystoreDeviceKeys {
    private const val PROVIDER = "AndroidKeyStore"
    private const val ALIAS = "ignit_drm_device_rsa_v1"

    fun ensureKeyPairAndPublicKeyPem(): String {
        val ks = KeyStore.getInstance(PROVIDER).apply { load(null) }
        if (!ks.containsAlias(ALIAS)) {
            val kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, PROVIDER)
            val spec = KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_DECRYPT or KeyProperties.PURPOSE_ENCRYPT,
            )
                .setKeySize(2048)
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
                .build()
            kpg.initialize(spec)
            kpg.generateKeyPair()
        }
        val cert = ks.getCertificate(ALIAS)
        val b64 = Base64.encodeToString(cert.publicKey.encoded, Base64.NO_WRAP)
        return "-----BEGIN PUBLIC KEY-----\n$b64\n-----END PUBLIC KEY-----"
    }

    fun unwrapCek(wrappedCekBase64: String): ByteArray {
        val ks = KeyStore.getInstance(PROVIDER).apply { load(null) }
        val privKey = ks.getKey(ALIAS, null)
        val cipher = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding")
        cipher.init(Cipher.DECRYPT_MODE, privKey)
        return cipher.doFinal(Base64.decode(wrappedCekBase64, Base64.DEFAULT))
    }
}

fun applyTier3WindowSecurity(activity: Activity, contentTier: String) {
    if (Tier3ScreenSecurityPolicy.shouldEnableFlagSecure(contentTier)) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
}
