// core/application: use case. Validates locally, delegates the network and the storage to ports.
package dev.ignit.application.usecase

import dev.ignit.application.port.AuthGateway
import dev.ignit.application.port.AuthSession
import dev.ignit.domain.model.AuthException
import dev.ignit.domain.model.UserSession
import kotlin.coroutines.cancellation.CancellationException

/**
 * Signs the user in against the remote backend and persists the resulting session.
 *
 * Empty fields are rejected before the network is touched, and nothing is written to the
 * session store unless [AuthGateway.signIn] actually succeeded with a session cookie the
 * backend would accept back.
 */
class LogIn(
	private val gateway: AuthGateway,
	private val session: AuthSession,
) {
	suspend operator fun invoke(email: String, password: String): Result<UserSession> {
		val trimmedEmail = email.trim()
		if (trimmedEmail.isBlank()) return Result.failure(AuthException(EMAIL_REQUIRED))
		if (password.isBlank()) return Result.failure(AuthException(PASSWORD_REQUIRED))

		val signedIn = try {
			gateway.signIn(trimmedEmail, password)
		} catch (cancellation: CancellationException) {
			throw cancellation
		} catch (error: Exception) {
			return Result.failure(error)
		}

		// `GetCurrentSession` refuses a session without a cookie, so persisting this one would sign
		// the user in only until the next launch. Reject it here instead, before anything is stored.
		if (signedIn.sessionCookie.isBlank()) {
			return Result.failure(AuthException(SIGN_IN_WITHOUT_COOKIE))
		}

		return try {
			session.save(signedIn)
			Result.success(signedIn)
		} catch (cancellation: CancellationException) {
			throw cancellation
		} catch (error: Exception) {
			Result.failure(error)
		}
	}

	companion object {
		const val EMAIL_REQUIRED: String = "Ingresá tu email"
		const val PASSWORD_REQUIRED: String = "Ingresá tu contraseña"

		/** Shown when the backend signed the user in but handed back no session cookie to send back. */
		const val SIGN_IN_WITHOUT_COOKIE: String = "No pudimos iniciar sesión correctamente. Probá de nuevo."
	}
}
