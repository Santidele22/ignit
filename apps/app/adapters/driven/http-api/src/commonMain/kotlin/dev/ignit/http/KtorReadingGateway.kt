package dev.ignit.http

import dev.ignit.application.port.AuthSession
import dev.ignit.application.port.ReadingContentGateway
import dev.ignit.domain.model.AuthException
import dev.ignit.domain.model.DomainReadingChunk
import dev.ignit.domain.model.DomainReadingDocument
import dev.ignit.domain.model.ReadingProgress
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

class KtorReadingGateway(
	private val client: HttpClient,
	private val baseUrl: String,
	private val session: AuthSession? = null,
	private val booksPath: String = "/api/books",
) : ReadingContentGateway {
	private val json = Json { ignoreUnknownKeys = true }

	private suspend fun attachAuthHeaders(builder: io.ktor.client.request.HttpRequestBuilder) {
		val current = session?.load() ?: return
		if (current.token.isNotBlank()) {
			builder.header(HttpHeaders.Authorization, "Bearer ${current.token}")
		}
		if (current.sessionCookie.isNotBlank()) {
			builder.header(HttpHeaders.Cookie, current.sessionCookie)
		}
	}

	override suspend fun fetchReading(bookId: String): DomainReadingDocument {
		val url = "${baseUrl.trimEnd('/')}$booksPath/$bookId/reading"
		val response = client.get(url) { attachAuthHeaders(this) }
		val body = response.bodyAsText()
		if (!response.status.isSuccess()) {
			if (response.status == HttpStatusCode.Unauthorized) {
				throw AuthException("Tu sesión expiró. Volvé a iniciar sesión.")
			}
			throw IllegalStateException("No pudimos abrir el libro (${response.status.value}).")
		}
		val obj = json.parseToJsonElement(body).jsonObject
		val chunks = obj["chunks"]?.jsonArray.orEmpty().map { el ->
			val c = el.jsonObject
			DomainReadingChunk(
				id = c["id"]?.jsonPrimitive?.contentOrNull.orEmpty(),
				type = c["type"]?.jsonPrimitive?.contentOrNull ?: "para",
				page = c["page"]?.jsonPrimitive?.intOrNull ?: 1,
				offset = c["offset"]?.jsonPrimitive?.intOrNull ?: 0,
				text = c["text"]?.jsonPrimitive?.contentOrNull.orEmpty(),
				mood = c["mood"]?.jsonPrimitive?.contentOrNull ?: "espera",
				level = c["level"]?.jsonPrimitive?.intOrNull,
				align = c["align"]?.jsonPrimitive?.contentOrNull ?: "left",
			)
		}
		return DomainReadingDocument(
			bookId = obj["bookId"]?.jsonPrimitive?.contentOrNull ?: bookId,
			pdfPages = obj["pdfPages"]?.jsonPrimitive?.intOrNull ?: 1,
			ocrPending = obj["ocrPending"]?.jsonPrimitive?.booleanOrNull ?: false,
			chunks = chunks,
		)
	}

	override suspend fun fetchRemoteProgress(bookId: String): ReadingProgress? {
		val url = "${baseUrl.trimEnd('/')}$booksPath/$bookId/reading-state"
		val response = client.get(url) { attachAuthHeaders(this) }
		if (!response.status.isSuccess()) return null
		val obj = json.parseToJsonElement(response.bodyAsText()).jsonObject
		val progress = obj["progress"]?.jsonObject ?: return null
		val page = (progress["page"]?.jsonPrimitive?.intOrNull ?: 1).coerceAtLeast(1)
		val pct = (progress["pct"]?.jsonPrimitive?.doubleOrNull ?: 0.0).coerceIn(0.0, 1.0)
		val chunkId = progress["chunkId"]?.jsonPrimitive?.contentOrNull
		return ReadingProgress(bookId = bookId, page = page, pct = pct, chunkId = chunkId)
	}

	override suspend fun pushRemoteProgress(progress: ReadingProgress) {
		val url = "${baseUrl.trimEnd('/')}$booksPath/${progress.bookId}/reading-state"
		val payload = buildJsonObject {
			put(
				"progress",
				buildJsonObject {
					put("page", progress.page)
					put("pct", progress.pct)
					progress.chunkId?.let { put("chunkId", it) }
				},
			)
		}
		val response = client.put(url) {
			attachAuthHeaders(this)
			contentType(ContentType.Application.Json)
			setBody(payload.toString())
		}
		if (!response.status.isSuccess()) {
			throw IllegalStateException("No pudimos sincronizar tu progreso (${response.status.value}).")
		}
	}
}
