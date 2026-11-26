// core/application: use cases. Session read and clear stay thin over the storage port.
package dev.ignit.application.usecase

import dev.ignit.application.port.AuthSession
import dev.ignit.domain.model.UserSession

/**
 * Reads the session persisted by a previous [LogIn], or null when the user never signed in.
 *
 * A session is only returned when it carries the signed session cookie, because that is the
 * credential the backend verifies: better-auth resolves the session from the request headers and
 * has no bearer plugin, so a session holding just the raw body token cannot authenticate. Sessions
 * written by older builds (before the cookie was persisted) therefore resolve to null and the app
 * asks the user to sign in again, instead of showing a library that fails with `Unauthorized`.
 */
class GetCurrentSession(private val session: AuthSession) {
	suspend operator fun invoke(): UserSession? = session.load()?.takeIf { it.sessionCookie.isNotBlank() }
}

/** Drops the persisted session so the next launch starts at the login screen again. */
class LogOut(private val session: AuthSession) {
	suspend operator fun invoke() {
		session.clear()
	}
}
