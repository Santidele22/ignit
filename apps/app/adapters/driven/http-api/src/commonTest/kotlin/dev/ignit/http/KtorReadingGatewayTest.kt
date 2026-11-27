package dev.ignit.http

import dev.ignit.application.port.AuthSession
import dev.ignit.domain.model.ReadingProgress
import dev.ignit.domain.model.UserSession
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

class KtorReadingGatewayTest {
	@Test
	fun fetchesReadingDocumentAndReadsWritesProgressWithSessionCookie() = runTest {
		var lastCookie: String? = null
		var lastPutMethod: HttpMethod? = null

		val engine = MockEngine { request ->
			lastCookie = request.headers[HttpHeaders.Cookie]
			when {
				request.url.encodedPath.endsWith("/reading") -> respond(
					content = """{"bookId":"7","pdfPages":12,"ocrPending":false,"chunks":[{"id":"c1","type":"heading","page":1,"offset":0,"text":"Capítulo I","level":1}]}""",
					status = HttpStatusCode.OK,
					headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
				)
				request.url.encodedPath.endsWith("/reading-state") && request.method == HttpMethod.Get -> respond(
					content = """{"bookId":"7","progress":{"page":5,"pct":0.4,"chunkId":"c1"}}""",
					status = HttpStatusCode.OK,
					headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
				)
				request.url.encodedPath.endsWith("/reading-state") && request.method == HttpMethod.Put -> {
					lastPutMethod = request.method
					respond(
						content = """{"ok":true}""",
						status = HttpStatusCode.OK,
						headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
					)
				}
				else -> respond("Not found", HttpStatusCode.NotFound)
			}
		}

		val sessionStore = object : AuthSession {
			override suspend fun load(): UserSession = UserSession(
				userId = "u1",
				email = "test@ignit.app",
				name = "Test",
				token = "tok",
				sessionCookie = "better-auth.session_token=signed",
			)
			override suspend fun save(session: UserSession) {}
			override suspend fun clear() {}
		}

		val gateway = KtorReadingGateway(
			client = HttpClient(engine),
			baseUrl = "https://ignit.example.com",
			session = sessionStore,
		)

		val doc = gateway.fetchReading("7")
		assertEquals("7", doc.bookId)
		assertEquals(12, doc.pdfPages)
		assertEquals("Capítulo I", doc.chunks.first().text)
		assertEquals("better-auth.session_token=signed", lastCookie)

		val remote = gateway.fetchRemoteProgress("7")
		assertEquals(5, remote?.page)

		gateway.pushRemoteProgress(ReadingProgress(bookId = "7", page = 8, pct = 0.66, updatedAtEpochMs = 100L))
		assertEquals(HttpMethod.Put, lastPutMethod)
	}
}
