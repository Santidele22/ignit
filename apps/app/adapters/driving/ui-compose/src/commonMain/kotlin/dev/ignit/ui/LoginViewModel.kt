// adapters/driving/ui-compose: driving adapter. Login state over the LogIn use case — no Ktor, no storage.
package dev.ignit.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.ignit.application.usecase.LogIn
import dev.ignit.domain.model.UserSession

/**
 * Compose-observable state of the login form.
 *
 * Plain class on purpose (same convention as [LibraryViewModel]): the screen owns the instance and
 * every write goes through a method, so the UI never has to guard duplicate submissions itself.
 */
class LoginViewModel(private val logIn: LogIn) {
	var email by mutableStateOf("")
		private set
	var password by mutableStateOf("")
		private set
	var loading by mutableStateOf(false)
		private set
	var error by mutableStateOf<String?>(null)
		private set
	var session by mutableStateOf<UserSession?>(null)
		private set

	/** Editing a field clears the previous failure so stale errors do not distract from the retry. */
	fun onEmailChange(value: String) {
		email = value
		error = null
	}

	fun onPasswordChange(value: String) {
		password = value
		error = null
	}

	/** Signs in through [logIn]; re-entrant calls while [loading] are ignored. */
	suspend fun submit() {
		if (loading) return

		loading = true
		error = null
		try {
			logIn(email, password).fold(
				onSuccess = { session = it },
				onFailure = { failure -> error = failure.message ?: UNEXPECTED_ERROR },
			)
		} finally {
			loading = false
		}
	}

	/**
	 * Drops the signed-in session held here. The root app calls this when the user logs out, so a
	 * re-entered login screen does not immediately navigate back to the library.
	 *
	 * The typed password is cleared too: leaving it behind would re-authenticate the next user of the
	 * device with a single tap. The email is kept as a convenience for the next sign-in.
	 */
	fun clearSession() {
		session = null
		password = ""
		error = null
	}

	companion object {
		/** Fallback for failures without a message, e.g. a dropped connection. */
		const val UNEXPECTED_ERROR: String = "No pudimos iniciar sesión. Intentá de nuevo."
	}
}
