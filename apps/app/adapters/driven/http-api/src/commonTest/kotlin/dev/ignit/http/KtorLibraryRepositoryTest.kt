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
private const val SPANISH_LIBRARY_FALLBACK = "No pudimos cargar la biblioteca."

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
	token: String = "tok_body",
	booksPath: String = BOOKS_PATH,
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
			token = token,
			sessionCookie = sessionCookie,
		),
	)
	return KtorLibraryRepository(client, BASE_URL, session, booksPath)
}

private const val PUBLIC_BOOK_JSON =
	"""{"id":12,"title":"Clean Architecture","author":"Robert C. Martin","kind":"tecnico",""" +
		""""coverUrl":"https://covers.test/clean.jpg","published":true}"""

class KtorLibraryRepositoryTest {
	@Test
	fun requestsTheProductionBooksPath() = runTest {
		val captured = mutableListOf<HttpRequestData>()
		val repository = repositoryOver(captured, "[]", booksPath = "/api/books")

		// Production serves the catalog behind the Worker proxy, so the /api prefix is part of the
		// profile and never added by the adapter.
		repository.fetchLibrary()

		assertEquals("/api/books", captured.single().url.encodedPath)
	}

	@Test
	fun requestsTheLocalBooksPath() = runTest {
		val captured = mutableListOf<HttpRequestData>()
		val repository = repositoryOver(captured, "[]", booksPath = "/books")

		// The local backend mounts the REST routes at the root: `/api/books` is a 404 there.
		repository.fetchLibrary(limit = 12, offset = 0)

		val request = captured.single()
		assertEquals("/books", request.url.encodedPath)
		assertEquals("12", request.url.parameters["limit"])
		assertEquals("0", request.url.parameters["offset"])
	}

	@Test
	fun asksForThePublicCatalogPageWithoutCookie() = runTest {
		val captured = mutableListOf<HttpRequestData>()
		val repository = repositoryOver(captured, "[$PUBLIC_BOOK_JSON]")

		repository.fetchLibrary(limit = 12, offset = 0)

		val request = captured.single()
		assertEquals(HttpMethod.Get, request.method)
		assertEquals(BOOKS_PATH, request.url.encodedPath)
		assertEquals("12", request.url.parameters["limit"])
		assertEquals("0", request.url.parameters["offset"])
		assertFalse(request.url.parameters.contains("mine"))
		assertNull(request.headers[HttpHeaders.Cookie])
	}

	@Test
	fun requestedPageIsSentAsLimitAndOffset() = runTest {
		val captured = mutableListOf<HttpRequestData>()
		val repository = repositoryOver(captured, "[]")

		repository.fetchLibrary(limit = 6, offset = 18)

		val request = captured.single()
		assertEquals("6", request.url.parameters["limit"])
		assertEquals("18", request.url.parameters["offset"])
	}

	@Test
	fun parsesABareJsonArrayIntoAPage() = runTest {
		val repository = repositoryOver(mutableListOf(), "[$PUBLIC_BOOK_JSON]")

		val page = repository.fetchLibrary()

		assertEquals(1, page.items.size)
		val book = page.items.single()
		assertEquals("12", book.id)
		assertEquals("Clean Architecture", book.title)
		assertEquals("Robert C. Martin", book.author)
		assertEquals("tecnico", book.kind)
		assertEquals("https://covers.test/clean.jpg", book.coverUrl)
		assertTrue(book.published)
	}

	@Test
	fun bareArraySynthesizesTheTotalAndEchoesTheRequestedPage() = runTest {
		val repository = repositoryOver(mutableListOf(), "[$PUBLIC_BOOK_JSON]")

		val page = repository.fetchLibrary(limit = 5, offset = 10)

		assertEquals(1, page.total)
		assertEquals(10, page.offset)
		assertEquals(5, page.limit)
		assertFalse(page.hasMore)
	}

	@Test
	fun parsesThePaginatedEnvelopeIntoAPage() = runTest {
		val repository = repositoryOver(
			mutableListOf(),
			"""{"items":[$PUBLIC_BOOK_JSON],"total":1,"offset":0,"limit":20}""",
		)

		val page = repository.fetchLibrary(limit = 20, offset = 0)

		assertEquals(listOf("12"), page.items.map { it.id })
		assertEquals(1, page.total)
		assertEquals(0, page.offset)
		assertEquals(20, page.limit)
	}

	@Test
	fun envelopeTotalGreaterThanTheItemsCountReportsMorePages() = runTest {
		val repository = repositoryOver(
			mutableListOf(),
			"""{"items":[$PUBLIC_BOOK_JSON],"total":24,"offset":0,"limit":1}""",
		)

		val page = repository.fetchLibrary(limit = 1, offset = 0)

		assertEquals(24, page.total)
		assertEquals(1, page.items.size)
		assertTrue(page.hasMore)
	}

	@Test
	fun emptyItemsArrayIsAValidEmptyPage() = runTest {
		val repository = repositoryOver(
			mutableListOf(),
			"""{"items":[],"total":24,"offset":24,"limit":12}""",
		)

		val page = repository.fetchLibrary(offset = 24)

		assertTrue(page.items.isEmpty())
		assertEquals(24, page.total)
		assertFalse(page.hasMore)
	}

	@Test
	fun missingScalarsFallBackToSafeDefaults() = runTest {
		val repository = repositoryOver(mutableListOf(), """[{"id":7,"title":"Sin autor"}]""")

		val book = repository.fetchLibrary().items.single()

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

		val book = repository.fetchLibrary().items.single()

		assertEquals(18, book.totalPages)
	}

	@Test
	fun missingFilePagesFallsBackToZero() = runTest {
		val repository = repositoryOver(
			mutableListOf(),
			"""[{"id":12,"title":"Clean Architecture","kind":"tecnico"}]""",
		)

		val book = repository.fetchLibrary().items.single()

		assertEquals(0, book.totalPages)
	}

	@Test
	fun mineAddsTheMineQueryParameter() = runTest {
		val captured = mutableListOf<HttpRequestData>()
		val repository = repositoryOver(captured, "[]")

		repository.fetchLibrary(mine = true)

		val request = captured.single()
		assertEquals(BOOKS_PATH, request.url.encodedPath)
		assertEquals("true", request.url.parameters["mine"])
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
		assertEquals("true", request.url.parameters["mine"])
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
	fun tokenIsSentAsABearerAuthorizationHeader() = runTest {
		val captured = mutableListOf<HttpRequestData>()
		val repository = repositoryOver(captured, "[]", token = "tok_prod")

		repository.fetchLibrary(mine = true)

		val request = captured.single()
		assertEquals("Bearer tok_prod", request.headers[HttpHeaders.Authorization])
		assertNull(request.headers[HttpHeaders.Cookie])
	}

	@Test
	fun bothCredentialsAreSentWhenTheSessionCarriesBoth() = runTest {
		val captured = mutableListOf<HttpRequestData>()
		val cookie = "better-auth.session_token=signed.value"
		val repository = repositoryOver(captured, "[]", sessionCookie = cookie, token = "tok_both")

		repository.fetchLibrary(mine = true)

		val request = captured.single()
		assertEquals("Bearer tok_both", request.headers[HttpHeaders.Authorization])
		assertEquals(cookie, request.headers[HttpHeaders.Cookie])
	}

	@Test
	fun neitherCredentialIsSentWhenBothAreBlank() = runTest {
		val captured = mutableListOf<HttpRequestData>()
		val repository = repositoryOver(captured, "[]", sessionCookie = "", token = "")

		repository.fetchLibrary(mine = true)

		val request = captured.single()
		assertNull(request.headers[HttpHeaders.Authorization])
		assertNull(request.headers[HttpHeaders.Cookie])
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
	fun aJsonObjectWithoutItemsIsRejectedInsteadOfReadAsAnEmptyLibrary() = runTest {
		val repository = repositoryOver(mutableListOf(), """{"message":"boom"}""")

		val failure = assertFailsWith<AuthException> { repository.fetchLibrary() }

		assertEquals(SPANISH_LIBRARY_FALLBACK, failure.message)
	}

	@Test
	fun aJsonObjectWhoseItemsIsNotAnArrayIsRejected() = runTest {
		val repository = repositoryOver(mutableListOf(), """{"items":"boom"}""")

		val failure = assertFailsWith<AuthException> { repository.fetchLibrary() }

		assertEquals(SPANISH_LIBRARY_FALLBACK, failure.message)
	}

	@Test
	fun aRootThatIsNeitherAnArrayNorAnObjectIsRejected() = runTest {
		val repository = repositoryOver(mutableListOf(), "42")

		val failure = assertFailsWith<AuthException> { repository.fetchLibrary() }

		assertEquals(SPANISH_LIBRARY_FALLBACK, failure.message)
	}

	@Test
	fun anInvalidPageIsRejectedBeforeAnyRequestIsMade() = runTest {
		val captured = mutableListOf<HttpRequestData>()
		val repository = repositoryOver(captured, "[]")

		assertFailsWith<IllegalArgumentException> { repository.fetchLibrary(limit = 0) }
		assertFailsWith<IllegalArgumentException> { repository.fetchLibrary(offset = -1) }
		assertTrue(captured.isEmpty())
	}

	@Test
	fun transportFailureBecomesTheSpanishConnectionFallback() = runTest {
		val client = HttpClient(MockEngine { throw IOException("connection reset") }) {
			expectSuccess = false
		}
		val repository = KtorLibraryRepository(client, BASE_URL, FakeSession(null), BOOKS_PATH)

		val failure = assertFailsWith<AuthException> { repository.fetchLibrary() }

		assertEquals(SPANISH_CONNECTION_FALLBACK, failure.message)
	}
}
