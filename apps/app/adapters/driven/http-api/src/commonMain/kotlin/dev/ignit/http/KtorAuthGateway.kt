// adapters/driven/http-api: implements the AuthGateway port over the Ignit HTTP API.
package dev.ignit.http

import dev.ignit.application.port.AuthGateway
import dev.ignit.domain.model.AuthException
import dev.ignit.domain.model.UserSession
import io.ktor.client.HttpClient
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

private const val SIGN_IN_PATH = "/api/auth/sign-in/email"
private const val SESSION_COOKIE_NAME = "better-auth.session_token"

/** Shown when the backend rejected the sign-in without a readable message. */
private const val SIGN_IN_FALLBACK = "No pudimos iniciar sesión. Probá de nuevo."

/** Shown when the request never reached the backend. */
private const val CONNECTION_FALLBACK = "No pudimos conectar con el servidor."

/**
 * Signs in against `POST {baseUrl}/api/auth/sign-in/email`, mirroring the web flow.
 *
 * A 2xx answer is mapped to [UserSession] using the body `token` (or the
 * `better-auth.session_token` cookie). A 4xx/5xx answer throws [AuthException] carrying the
 * backend's own `message`. Transport and parse failures never leak raw exception types.
 */
class KtorAuthGateway(private val client: HttpClient, private val baseUrl: String) : AuthGateway {

	override suspend fun signIn(email: String, password: String): UserSession {
		val response = try {
			client.post("$baseUrl$SIGN_IN_PATH") {
				header(HttpHeaders.Origin, baseUrl)
				contentType(ContentType.Application.Json)
				setBody(
					buildJsonObject {
						put("email", email)
						put("password", password)
					}.toString(),
				)
			}
		} catch (cancellation: CancellationException) {
			throw cancellation
		} catch (transportFailure: Throwable) {
			throw AuthException(CONNECTION_FALLBACK)
		}

		val body = try {
			response.bodyAsText()
		} catch (cancellation: CancellationException) {
			throw cancellation
		} catch (transportFailure: Throwable) {
			throw AuthException(CONNECTION_FALLBACK)
		}

		if (!response.status.isSuccess()) {
			throw AuthException(backendMessage(body) ?: SIGN_IN_FALLBACK)
		}
		return sessionFrom(body, response.headers)
	}

	private fun sessionFrom(body: String, headers: Headers): UserSession {
		val payload = try {
			Json.parseToJsonElement(body) as? JsonObject
		} catch (parseFailure: Exception) {
			null
		} ?: throw AuthException(SIGN_IN_FALLBACK)
		val user = payload["user"] as? JsonObject
		val token = payload.string("token")
			?: sessionCookie(headers)
			?: throw AuthException(SIGN_IN_FALLBACK)
		return UserSession(
			userId = user?.string("id") ?: "",
			email = user?.string("email") ?: "",
			name = user?.string("name") ?: "",
			token = token,
		)
	}

	private fun sessionCookie(headers: Headers): String? =
		headers.getAll(HttpHeaders.SetCookie)
			.orEmpty()
			.asSequence()
			.map { it.substringBefore(';').trim() }
			.filter { cookieName(it) == SESSION_COOKIE_NAME }
			.map { it.substringAfter('=', missingDelimiterValue = "").trim() }
			.firstOrNull { it.isNotEmpty() }

	/**
	 * Drops the browser security prefixes a cookie arrives with. The backend sets the session cookie
	 * as `__Secure-better-auth.session_token` in production and unprefixed on localhost, so matching
	 * the bare name alone would miss every production sign-in.
	 */
	private fun cookieName(raw: String): String = raw
		.substringBefore('=', missingDelimiterValue = "")
		.trim()
		.removePrefix("__Secure-")
		.removePrefix("__Host-")

	private fun backendMessage(body: String): String? = try {
		(Json.parseToJsonElement(body) as? JsonObject)
			?.string("message")
			?.takeIf { it.isNotBlank() }
	} catch (parseFailure: Exception) {
		null
	}

	/** Reads a scalar JSON field, defaulting missing or non-scalar values to `null`. */
	private fun JsonObject.string(key: String): String? =
		(this[key] as? JsonPrimitive)?.contentOrNull
}
