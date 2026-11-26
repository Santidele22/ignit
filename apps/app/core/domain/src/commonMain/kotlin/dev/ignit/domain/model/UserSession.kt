// core/domain: entity and auth failure carried across every login boundary.
package dev.ignit.domain.model

/**
 * The signed-in user together with the credentials the backend handed back.
 *
 * [token] is the raw token from the sign-in body when present. [sessionCookie] is the full
 * `name=value` pair of the session cookie, and it is the credential the backend actually
 * accepts: better-auth verifies the signed cookie (`getSession({ headers })`) and this app
 * has no bearer plugin to send [token] to.
 */
data class UserSession(
	val userId: String,
	val email: String,
	val name: String,
	val token: String,
	val sessionCookie: String = "",
)

/**
 * A rejected sign-in. [message] is what the user should read: either the backend's own
 * `message` field or the local validation text, never a raw stack trace.
 */
class AuthException(override val message: String) : Exception(message)
