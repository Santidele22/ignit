// adapters/driven/http-api: contract tests for KtorLibraryRepository against a MockEngine.
package dev.ignit.http

import dev.ignit.application.port.AuthSession
import dev.ignit.domain.model.AuthException
import dev.ignit.domain.model.UserSession
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val BASE_URL = "https://ignit.ignit677.workers.dev"
private const val BOOKS_PATH = "/api/books"
private const val SPANISH_CONNECTION_FALLBACK = "No pudimos conectar con el servidor."

private class FakeSession(private val current: UserSession?) : AuthSession {
	override suspend fun load(): UserSession? = current

	override suspend fun save(session: UserSession) = Unit

	override suspend fun clear() = Unit
}

/** Builds the repository over a MockEngine that answers [body] and records every request. */
private fun repositoryOver(
	captured: MutableList<HttpRequestData>,
	body: String,
	status: HttpStatusCode = HttpStatusCode.OK,
	contentType: ContentType = ContentType.Application.Json,
	sessionCookie: String = "",
): KtorLibraryRepository {
	val client = HttpClient(
		MockEngine { request ->
			captured += request
			respond(
				content = body,
				status = status,
				headers = headersOf(HttpHeaders.ContentType, contentType.toString()),
			)
		},
	) { expectSuccess = false }
	val session = FakeSession(
		UserSession(
			userId = "usr_1",
			email = "santi@ignit.ar",
			name = "Santi",
			token = "tok_body",
			sessionCookie = sessionCookie,
		),
	)
	return KtorLibraryRepository(client, BASE_URL, session)
}

private const val PUBLIC_BOOK_JSON =
	"""{"id":12,"title":"Clean Architecture","author":"Robert C. Martin","kind":"tecnico",""" +
		""""coverUrl":"https://covers.test/clean.jpg","published":true}"""

class KtorLibraryRepositoryTest {
	@Test
	fun asksForThePublicCatalogWithoutPaginationOrCookie() = runTest {
		val captured = mutableListOf<HttpRequestData>()
		val repository = repositoryOver(captured, "[$PUBLIC_BOOK_JSON]")

		repository.fetchLibrary()

		val request = captured.single()
		assertEquals(HttpMethod.Get, request.method)
		assertEquals(BOOKS_PATH, request.url.encodedPath)
		assertEquals("", request.url.encodedQuery)
		assertNull(request.headers[HttpHeaders.Cookie])
	}

	@Test
	fun parsesABareJsonArrayIntoBooks() = runTest {
		val repository = repositoryOver(mutableListOf(), "[$PUBLIC_BOOK_JSON]")

		val books = repository.fetchLibrary()

		assertEquals(1, books.size)
		val book = books.single()
		assertEquals("12", book.id)
		assertEquals("Clean Architecture", book.title)
		assertEquals("Robert C. Martin", book.author)
		assertEquals("tecnico", book.kind)
		assertEquals("https://covers.test/clean.jpg", book.coverUrl)
		assertTrue(book.published)
	}

	@Test
	fun parsesThePaginatedEnvelopeItems() = runTest {
		val repository = repositoryOver(
			mutableListOf(),
			"""{"items":[$PUBLIC_BOOK_JSON],"total":1,"offset":0,"limit":20}""",
		)

		val books = repository.fetchLibrary()

		assertEquals(listOf("12"), books.map { it.id })
	}

	@Test
	fun missingScalarsFallBackToSafeDefaults() = runTest {
		val repository = repositoryOver(mutableListOf(), """[{"id":7,"title":"Sin autor"}]""")

		val book = repository.fetchLibrary().single()

		assertEquals("7", book.id)
		assertEquals("Sin autor", book.title)
		assertEquals("", book.author)
		assertEquals("", book.kind)
		assertNull(book.coverUrl)
		assertFalse(book.published)
	}

	@Test
	fun filePagesBecomesTheBookTotalPages() = runTest {
		val repository = repositoryOver(
			mutableListOf(),
			"""[{"id":12,"title":"Clean Architecture","kind":"tecnico","filePages":18}]""",
		)

		val book = repository.fetchLibrary().single()

		assertEquals(18, book.totalPages)
	}

	@Test
	fun missingFilePagesFallsBackToZero() = runTest {
		val repository = repositoryOver(
			mutableListOf(),
			"""[{"id":12,"title":"Clean Architecture","kind":"tecnico"}]""",
		)

		val book = repository.fetchLibrary().single()

		assertEquals(0, book.totalPages)
	}

	@Test
	fun mineAddsTheMineQueryParameter() = runTest {
		val captured = mutableListOf<HttpRequestData>()
		val repository = repositoryOver(captured, "[]")

		repository.fetchLibrary(mine = true)

		val request = captured.single()
		assertEquals(BOOKS_PATH, request.url.encodedPath)
		assertEquals("mine=true", request.url.encodedQuery)
	}

	@Test
	fun kindIsForwardedUrlEncoded() = runTest {
		val captured = mutableListOf<HttpRequestData>()
		val repository = repositoryOver(captured, "[]")
		val kind = "no técnico & más"

		repository.fetchLibrary(kind = kind)

		val request = captured.single()
		assertTrue(request.url.encodedQuery.contains("%26"), request.url.encodedQuery)
		assertEquals(kind, request.url.parameters["kind"])
	}

	@Test
	fun blankKindIsNotSentAtAll() = runTest {
		val captured = mutableListOf<HttpRequestData>()
		val repository = repositoryOver(captured, "[]")

		repository.fetchLibrary(mine = true, kind = "   ")

		val request = captured.single()
		assertEquals("mine=true", request.url.encodedQuery)
		assertFalse(request.url.parameters.contains("kind"))
	}

	@Test
	fun storedSessionCookieIsSentVerbatim() = runTest {
		val captured = mutableListOf<HttpRequestData>()
		val cookie = "__Secure-better-auth.session_token=signed.value"
		val repository = repositoryOver(captured, "[]", sessionCookie = cookie)

		repository.fetchLibrary(mine = true)

		assertEquals(cookie, captured.single().headers[HttpHeaders.Cookie])
	}

	@Test
	fun unauthorizedSurfacesTheBackendMessage() = runTest {
		val repository = repositoryOver(
			mutableListOf(),
			"""{"message":"No autorizado","code":"UNAUTHORIZED"}""",
			status = HttpStatusCode.Unauthorized,
		)

		val failure = assertFailsWith<AuthException> { repository.fetchLibrary(mine = true) }

		assertEquals("No autorizado", failure.message)
	}

	@Test
	fun forbiddenSurfacesTheBackendMessage() = runTest {
		val repository = repositoryOver(
			mutableListOf(),
			"""{"message":"Prohibido"}""",
			status = HttpStatusCode.Forbidden,
		)

		val failure = assertFailsWith<AuthException> { repository.fetchLibrary() }

		assertEquals("Prohibido", failure.message)
	}

	@Test
	fun serverErrorSurfacesTheBackendMessage() = runTest {
		val repository = repositoryOver(
			mutableListOf(),
			"""{"message":"Falló el catálogo"}""",
			status = HttpStatusCode.InternalServerError,
		)

		val failure = assertFailsWith<AuthException> { repository.fetchLibrary() }

		assertEquals("Falló el catálogo", failure.message)
	}

	@Test
	fun transportFailureBecomesTheSpanishConnectionFallback() = runTest {
		val client = HttpClient(MockEngine { throw IOException("connection reset") }) {
			expectSuccess = false
		}
		val repository = KtorLibraryRepository(client, BASE_URL, FakeSession(null))

		val failure = assertFailsWith<AuthException> { repository.fetchLibrary() }

		assertEquals(SPANISH_CONNECTION_FALLBACK, failure.message)
	}
}
