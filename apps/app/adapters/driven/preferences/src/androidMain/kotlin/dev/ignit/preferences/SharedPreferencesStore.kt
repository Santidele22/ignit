// adapters/driven/preferences: keeps non-secret user preferences in Android SharedPreferences.
package dev.ignit.preferences

import android.content.Context
import android.content.SharedPreferences
import dev.ignit.application.port.Preferences

private const val PREFERENCES_NAME = "ignit.preferences"

/**
 * Stores the user's non-secret choices (palette, reader font) in a plain [SharedPreferences]
 * file named `ignit.preferences`.
 *
 * No encryption on purpose: these are preferences the user can re-make, not credentials — the
 * encrypted session lives in the auth-session adapter instead. [read] is total: an absent key
 * reads as null. [write] only returns once the value actually reached disk, and throws the
 * user-facing message otherwise, mirroring the session adapter's contract.
 */
class SharedPreferencesStore(context: Context) : Preferences {

	private val preferences: SharedPreferences =
		context.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

	override suspend fun read(key: String): String? = preferences.getString(key, null)

	override suspend fun write(key: String, value: String) {
		preferences.edit()
			.putString(key, value)
			.commit()
			.let { persisted ->
				check(persisted) { "No pudimos guardar la preferencia." }
			}
	}
}
