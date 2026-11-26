// core/application: use cases. Session read and clear stay thin over the storage port.
package dev.ignit.application.usecase

import dev.ignit.application.port.AuthSession
import dev.ignit.domain.model.UserSession

/**
 * Reads the session persisted by a previous [LogIn], or null when there is no usable one.
 *
 * The credential the backend accepts depends on the environment, and the client cannot know which
 * one it is talking to: production runs `session-mode = neon`, whose guard reads only
 * `Authorization: Bearer <token>`, while local development mounts better-auth, which resolves the
 * signed session cookie from the request headers. A stored session is therefore usable when it
 * carries either [UserSession.token] or [UserSession.sessionCookie].
 *
 * A session carrying neither is treated as signed out: the library endpoints would answer 401, so
 * the app asks the user to sign in again instead of landing on a screen that cannot load.
 */
class GetCurrentSession(private val session: AuthSession) {
	suspend operator fun invoke(): UserSession? = session.load()?.takeIf { stored ->
		stored.sessionCookie.isNotBlank() || stored.token.isNotBlank()
	}
}

/** Drops the persisted session so the next launch starts at the login screen again. */
class LogOut(private val session: AuthSession) {
	suspend operator fun invoke() {
		session.clear()
	}
}
