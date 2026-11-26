// adapters/driven/auth-session: shared JSON codec for the persisted session.
package dev.ignit.session

import dev.ignit.domain.model.UserSession
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private const val USER_ID = "userId"
private const val EMAIL = "email"
private const val NAME = "name"
private const val TOKEN = "token"

/**
 * Encodes and decodes [UserSession] with plain `JsonElement` APIs.
 *
 * The repo has no kotlinx-serialization compiler plugin, so the shape is written by hand.
 * [decode] is total: malformed JSON, a missing required string field or a non-string value
 * all yield `null`, and unknown fields are ignored so older payloads keep loading.
 */
object SessionCodec {

	fun encode(session: UserSession): String = buildJsonObject {
		put(USER_ID, session.userId)
		put(EMAIL, session.email)
		put(NAME, session.name)
		put(TOKEN, session.token)
	}.toString()

	fun decode(raw: String): UserSession? {
		val payload = try {
			Json.parseToJsonElement(raw) as? JsonObject
		} catch (malformed: SerializationException) {
			null
		} catch (malformed: IllegalArgumentException) {
			null
		} ?: return null
		return UserSession(
			userId = payload.string(USER_ID) ?: return null,
			email = payload.string(EMAIL) ?: return null,
			name = payload.string(NAME) ?: return null,
			token = payload.string(TOKEN) ?: return null,
		)
	}

	/** Reads a JSON string field, defaulting missing, `null` or non-string values to `null`. */
	private fun JsonObject.string(key: String): String? =
		(this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
}
