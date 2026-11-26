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
 * session store unless [AuthGateway.signIn] actually succeeded. Whatever credential that session
 * carries is persisted verbatim: production (`session-mode = neon`) authenticates a bearer token
 * while local development mounts better-auth and answers a cookie, so deciding here which one is
 * "the right one" would only lock out the other environment. [AuthGateway.signIn] already fails
 * when the backend hands back neither credential.
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
	}
}
