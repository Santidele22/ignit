// adapters/driven/auth-session: keeps the signed-in session encrypted with the Android Keystore.
package dev.ignit.session

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import dev.ignit.application.port.AuthSession
import dev.ignit.domain.model.UserSession
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.util.Base64
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val ANDROID_KEYSTORE = "AndroidKeyStore"
private const val KEY_ALIAS = "ignit.session.key"
private const val TRANSFORMATION = "AES/GCM/NoPadding"
private const val TAG_BITS = 128
private const val PREFERENCES_NAME = "ignit.session"
private const val KEY_IV = "iv"
private const val KEY_PAYLOAD = "payload"

/**
 * Persists the session encrypted with an `AES/GCM/NoPadding` key held by the Android Keystore.
 *
 * Only the Base64 IV and ciphertext reach [SharedPreferences]; the token never touches disk in
 * clear text. [load] is total: a missing preference, a key the system dropped (factory reset,
 * lock-screen change invalidating it) or a failed decrypt/parse all read as "not signed in".
 */
class KeystoreAuthSession(context: Context) : AuthSession {

	private val preferences: SharedPreferences =
		context.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

	override suspend fun load(): UserSession? {
		val iv = preferences.getString(KEY_IV, null) ?: return null
		val payload = preferences.getString(KEY_PAYLOAD, null) ?: return null
		val encoded = try {
			decrypt(Base64.getDecoder().decode(iv), Base64.getDecoder().decode(payload))
		} catch (invalidTag: AEADBadTagException) {
			return null
		} catch (invalidatedKey: KeyPermanentlyInvalidatedException) {
			return null
		} catch (cryptoFailure: GeneralSecurityException) {
			return null
		} catch (malformedPayload: IllegalArgumentException) {
			return null
		} catch (missingKey: IllegalStateException) {
			return null
		} catch (unreadableStore: IOException) {
			// A keystore we cannot open holds no session we could decrypt: start at the login screen.
			return null
		}
		return SessionCodec.decode(encoded)
	}

	override suspend fun save(session: UserSession) {
		val cipher = Cipher.getInstance(TRANSFORMATION)
		cipher.init(Cipher.ENCRYPT_MODE, secretKey())
		val payload = cipher.doFinal(SessionCodec.encode(session).toByteArray(Charsets.UTF_8))
		preferences.edit()
			.putString(KEY_IV, Base64.getEncoder().encodeToString(cipher.iv))
			.putString(KEY_PAYLOAD, Base64.getEncoder().encodeToString(payload))
			.commit()
			.let { persisted ->
				check(persisted) { "No pudimos guardar la sesión en este dispositivo." }
			}
	}

	override suspend fun clear() {
		preferences.edit()
			.remove(KEY_IV)
			.remove(KEY_PAYLOAD)
			.commit()
			.let { cleared ->
				check(cleared) { "No pudimos cerrar la sesión en este dispositivo." }
			}
		try {
			keyStore().deleteEntry(KEY_ALIAS)
		} catch (cryptoFailure: GeneralSecurityException) {
			// Nothing stored under the alias: forgetting the preferences is enough.
		} catch (unreadableStore: IOException) {
			// Same: a keystore we cannot open holds no session we could decrypt anyway.
		}
	}

	private fun decrypt(iv: ByteArray, payload: ByteArray): String {
		val cipher = Cipher.getInstance(TRANSFORMATION)
		cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, iv))
		return cipher.doFinal(payload).toString(Charsets.UTF_8)
	}

	/** Returns the session key, generating it on first use. */
	private fun secretKey(): SecretKey {
		val store = keyStore()
		(store.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
		val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
		generator.init(
			KeyGenParameterSpec.Builder(
				KEY_ALIAS,
				KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
			)
				.setBlockModes(KeyProperties.BLOCK_MODE_GCM)
				.setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
				.build(),
		)
		return generator.generateKey()
	}

	private fun keyStore(): KeyStore =
		KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
}
