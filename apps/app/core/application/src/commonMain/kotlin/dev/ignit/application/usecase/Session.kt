// core/application: use cases. Session read and clear stay thin over the storage port.
package dev.ignit.application.usecase

import dev.ignit.application.port.AuthSession
import dev.ignit.domain.model.UserSession

/** Reads the session persisted by a previous [LogIn], or null when the user never signed in. */
class GetCurrentSession(private val session: AuthSession) {
	suspend operator fun invoke(): UserSession? = session.load()
}

/** Drops the persisted session so the next launch starts at the login screen again. */
class LogOut(private val session: AuthSession) {
	suspend operator fun invoke() {
		session.clear()
	}
}
