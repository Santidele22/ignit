// core/domain: entity and auth failure carried across every login boundary.
package dev.ignit.domain.model

/** The signed-in user together with the token the backend handed back. */
data class UserSession(
	val userId: String,
	val email: String,
	val name: String,
	val token: String,
)

/**
 * A rejected sign-in. [message] is what the user should read: either the backend's own
 * `message` field or the local validation text, never a raw stack trace.
 */
class AuthException(override val message: String) : Exception(message)
