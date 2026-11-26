// adapters/driven/http-api: implements the LibraryRepository port over `GET /api/books`.
package dev.ignit.http

import dev.ignit.application.port.AuthSession
import dev.ignit.application.port.LibraryRepository
import dev.ignit.domain.model.AuthException
import dev.ignit.domain.model.Book
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

private const val BOOKS_PATH = "/api/books"

/** Key of the paginated envelope `{ items, total, offset, limit }` the controller returns. */
private const val ITEMS_KEY = "items"

private const val MINE_PARAM = "mine"
private const val KIND_PARAM = "kind"

/** Shown when the catalog answered something unreadable. */
private const val LIBRARY_FALLBACK = "No pudimos cargar la biblioteca."

/** Shown when the request never reached the backend. */
private const val CONNECTION_FALLBACK = "No pudimos conectar con el servidor."

/**
 * Reads the Ignit catalog from `GET {baseUrl}/api/books`.
 *
 * `mine = true` asks for the caller's own library (`?mine=true`, which the backend only
 * answers for an authenticated caller) and [Book.kind] narrows the shelf through `?kind=`.
 * Authentication rides on the session cookie resolved from [session], because the backend
 * verifies the signed better-auth cookie and accepts no bearer token.
 *
 * The response is either a bare array or the paginated envelope whose items live under
 * [ITEMS_KEY]; both are accepted. Anything else — an object without an `items` array, a bare
 * scalar, malformed JSON — is a backend failure, never an empty library. Any non-2xx answer
 * throws [AuthException] with the backend's own `message`, and transport failures become a
 * user-facing Spanish message.
 */
class KtorLibraryRepository(
	private val client: HttpClient,
	private val baseUrl: String,
	private val session: AuthSession,
) : LibraryRepository {

	override suspend fun fetchLibrary(mine: Boolean, kind: String?): List<Book> {
		val (status, body) = try {
			val cookie = session.load()?.sessionCookie.orEmpty()
			val response = client.get("$baseUrl$BOOKS_PATH") {
				if (mine) parameter(MINE_PARAM, "true")
				kind?.takeIf { it.isNotBlank() }?.let { parameter(KIND_PARAM, it) }
				if (cookie.isNotBlank()) header(HttpHeaders.Cookie, cookie)
			}
			response.status to response.bodyAsText()
		} catch (cancellation: CancellationException) {
			throw cancellation
		} catch (transportFailure: Throwable) {
			throw AuthException(CONNECTION_FALLBACK)
		}

		if (!status.isSuccess()) throw AuthException(backendMessage(body) ?: LIBRARY_FALLBACK)
		return books(body)
	}

	private fun books(body: String): List<Book> {
		val root = try {
			Json.parseToJsonElement(body)
		} catch (malformed: Exception) {
			throw AuthException(LIBRARY_FALLBACK)
		}
		val elements = when (root) {
			is JsonArray -> root
			is JsonObject -> root[ITEMS_KEY] as? JsonArray ?: throw AuthException(LIBRARY_FALLBACK)
			else -> throw AuthException(LIBRARY_FALLBACK)
		}
		return elements.mapNotNull { it as? JsonObject }.map(::bookFrom)
	}

	private fun bookFrom(payload: JsonObject): Book = Book(
		id = payload.string("id") ?: "",
		title = payload.string("title") ?: "",
		roomId = payload.string("roomId") ?: "",
		// The backend names the page count `filePages`; `totalPages` has no payload counterpart.
		totalPages = payload.int("filePages") ?: 0,
		author = payload.string("author") ?: "",
		kind = payload.string("kind") ?: "",
		coverUrl = payload.string("coverUrl"),
		published = payload.boolean("published") ?: false,
	)

	private fun backendMessage(body: String): String? = try {
		(Json.parseToJsonElement(body) as? JsonObject)
			?.string("message")
			?.takeIf { it.isNotBlank() }
	} catch (malformed: Exception) {
		null
	}

	/** Reads a scalar JSON field, defaulting missing or non-string values to `null`. */
	private fun JsonObject.string(key: String): String? =
		(this[key] as? JsonPrimitive)?.contentOrNull

	private fun JsonObject.int(key: String): Int? =
		(this[key] as? JsonPrimitive)?.contentOrNull?.toIntOrNull()

	private fun JsonObject.boolean(key: String): Boolean? =
		(this[key] as? JsonPrimitive)?.booleanOrNull
}
