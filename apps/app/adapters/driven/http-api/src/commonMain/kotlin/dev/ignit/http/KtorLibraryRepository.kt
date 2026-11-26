// adapters/driven/http-api: implements the LibraryRepository port over the books endpoint.
package dev.ignit.http

import dev.ignit.application.port.AuthSession
import dev.ignit.application.port.LibraryRepository
import dev.ignit.domain.model.AuthException
import dev.ignit.domain.model.Book
import dev.ignit.domain.model.BookPage
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

/** Key of the paginated envelope `{ items, total, offset, limit }` the controller returns. */
private const val ITEMS_KEY = "items"
private const val TOTAL_KEY = "total"
private const val OFFSET_KEY = "offset"
private const val LIMIT_KEY = "limit"

private const val MINE_PARAM = "mine"
private const val KIND_PARAM = "kind"
private const val LIMIT_PARAM = "limit"
private const val OFFSET_PARAM = "offset"

/** Shown when the catalog answered something unreadable. */
private const val LIBRARY_FALLBACK = "No pudimos cargar la biblioteca."

/** Shown when the request never reached the backend. */
private const val CONNECTION_FALLBACK = "No pudimos conectar con el servidor."

/**
 * Reads one page of the Ignit catalog from `GET {baseUrl}{booksPath}`.
 *
 * [booksPath] comes from the build-time environment profile: production serves the catalog at
 * `/api/books` behind the Worker proxy, while the local backend mounts it at `/books` and 404s the
 * prefixed route.
 *
 * `mine = true` asks for the caller's own library (`?mine=true`, which the backend only
 * answers for an authenticated caller) and [Book.kind] narrows the shelf through `?kind=`.
 * [limit] and [offset] always travel as query parameters, because sending them is what makes
 * the controller answer the paginated envelope. Authentication rides on the session read from
 * [session], and both credential forms are sent when it carries them: production runs in `neon`
 * mode and verifies `Authorization: Bearer <token>`, while local development mounts better-auth
 * and verifies the signed `Cookie` pair. The client cannot tell the two modes apart, so it offers
 * whichever credentials the session holds and lets the API reject what it does not accept.
 *
 * The response is either a bare array or the paginated envelope whose items live under
 * [ITEMS_KEY]. A bare array (the server ignored pagination) still yields a coherent
 * [BookPage]: its `total` becomes the items count and the requested page is echoed back as
 * `offset`/`limit`. A missing `total`, `offset` or `limit` in the envelope falls back the same
 * way. Anything else — an object without an `items` array, a bare scalar, malformed JSON — is a
 * backend failure, never an empty library. Any non-2xx answer throws [AuthException] with the
 * backend's own `message`, and transport failures become a user-facing Spanish message.
 */
class KtorLibraryRepository(
	private val client: HttpClient,
	private val baseUrl: String,
	private val session: AuthSession,
	private val booksPath: String,
) : LibraryRepository {

	override suspend fun fetchLibrary(mine: Boolean, kind: String?, limit: Int, offset: Int): BookPage {
		LibraryRepository.requireValidRequest(limit, offset)

		val (status, body) = try {
			val stored = session.load()
			val token = stored?.token.orEmpty()
			val cookie = stored?.sessionCookie.orEmpty()
			val response = client.get("$baseUrl$booksPath") {
				if (mine) parameter(MINE_PARAM, "true")
				kind?.takeIf { it.isNotBlank() }?.let { parameter(KIND_PARAM, it) }
				parameter(LIMIT_PARAM, limit)
				parameter(OFFSET_PARAM, offset)
				if (token.isNotBlank()) header(HttpHeaders.Authorization, "Bearer $token")
				if (cookie.isNotBlank()) header(HttpHeaders.Cookie, cookie)
			}
			response.status to response.bodyAsText()
		} catch (cancellation: CancellationException) {
			throw cancellation
		} catch (transportFailure: Throwable) {
			throw AuthException(CONNECTION_FALLBACK)
		}

		if (!status.isSuccess()) throw AuthException(backendMessage(body) ?: LIBRARY_FALLBACK)
		return pageOf(body, limit, offset)
	}

	/** Reads [body] as a page, echoing [requestedLimit]/[requestedOffset] wherever it is absent. */
	private fun pageOf(body: String, requestedLimit: Int, requestedOffset: Int): BookPage {
		val root = try {
			Json.parseToJsonElement(body)
		} catch (malformed: Exception) {
			throw AuthException(LIBRARY_FALLBACK)
		}
		val envelope: JsonObject?
		val elements = when (root) {
			is JsonArray -> {
				envelope = null
				root
			}
			is JsonObject -> {
				envelope = root
				root[ITEMS_KEY] as? JsonArray ?: throw AuthException(LIBRARY_FALLBACK)
			}
			else -> throw AuthException(LIBRARY_FALLBACK)
		}
		val items = elements.mapNotNull { it as? JsonObject }.map(::bookFrom)
		return BookPage(
			items = items,
			total = envelope?.int(TOTAL_KEY) ?: items.size,
			offset = envelope?.int(OFFSET_KEY) ?: requestedOffset,
			limit = envelope?.int(LIMIT_KEY) ?: requestedLimit,
		)
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
