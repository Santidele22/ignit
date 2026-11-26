// adapters/driven/http-api: contract tests for KtorAuthGateway against a MockEngine.
package dev.ignit.http

import dev.ignit.domain.model.AuthException
import dev.ignit.domain.model.UserSession
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandler
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull

private const val BASE_URL = "https://ignit.ignit677.workers.dev"
private const val LOCAL_BASE_URL = "http://10.0.2.2:3000"
private const val SIGN_IN_PATH = "/api/auth/sign-in/email"
private const val SPANISH_SIGN_IN_FALLBACK = "No pudimos iniciar sesión. Probá de nuevo."

private fun clientWith(handler: MockRequestHandler): HttpClient =
	HttpClient(MockEngine(handler)) { expectSuccess = false }

class KtorAuthGatewayTest {

	@Test
	fun requestMirrorsTheWebSignInFlow() = runTest {
		var captured: HttpRequestData? = null
		val client = clientWith { request ->
			captured = request
			respond(
				content = """{"token":"tok_abc","user":{"id":"usr_123","email":"santi@ignit.ar","name":"Santi"}}""",
				status = HttpStatusCode.OK,
				headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
			)
		}

		KtorAuthGateway(client, BASE_URL).signIn("santi@ignit.ar", "secreto123")

		val request = assertNotNull(captured)
		assertEquals(HttpMethod.Post, request.method)
		assertEquals(SIGN_IN_PATH, request.url.encodedPath)
		assertEquals(BASE_URL, request.headers[HttpHeaders.Origin])
		val body = request.body as TextContent
		assertEquals(ContentType.Application.Json, body.contentType?.withoutParameters())
		assertEquals("""{"email":"santi@ignit.ar","password":"secreto123"}""", body.text)
	}

	@Test
	fun anHttpsBaseSendsTheOriginHeader() = runTest {
		var captured: HttpRequestData? = null
		val client = clientWith { request ->
			captured = request
			respond(
				content = """{"token":"tok_abc","user":{"id":"usr_123"}}""",
				status = HttpStatusCode.OK,
			)
		}

		KtorAuthGateway(client, BASE_URL).signIn("santi@ignit.ar", "secreto123")

		assertEquals(BASE_URL, assertNotNull(captured).headers[HttpHeaders.Origin])
	}

	@Test
	fun aPlainHttpBaseSendsNoOriginHeaderAtAll() = runTest {
		var captured: HttpRequestData? = null
		val client = clientWith { request ->
			captured = request
			respond(
				content = """{"token":"tok_abc","user":{"id":"usr_123"}}""",
				status = HttpStatusCode.OK,
			)
		}

		KtorAuthGateway(client, LOCAL_BASE_URL).signIn("santi@ignit.ar", "secreto123")

		// The local better-auth backend rejects an origin it does not trust, and a native client
		// has no browser origin anyway, so the header must be absent rather than different.
		val request = assertNotNull(captured)
		assertNull(request.headers[HttpHeaders.Origin])
		// Everything else about the request is unchanged: same path, method, content type and body.
		assertEquals(HttpMethod.Post, request.method)
		assertEquals(SIGN_IN_PATH, request.url.encodedPath)
		val body = request.body as TextContent
		assertEquals(ContentType.Application.Json, body.contentType?.withoutParameters())
		assertEquals("""{"email":"santi@ignit.ar","password":"secreto123"}""", body.text)
	}

	@Test
	fun mapsTokenAndUserFromA200Body() = runTest {
		val client = clientWith {
			respond(
				content = """{"token":"tok_abc","user":{"id":"usr_123","email":"santi@ignit.ar","name":"Santi"}}""",
				status = HttpStatusCode.OK,
			)
		}

		val session = KtorAuthGateway(client, BASE_URL).signIn("santi@ignit.ar", "secreto123")

		assertEquals(
			UserSession(userId = "usr_123", email = "santi@ignit.ar", name = "Santi", token = "tok_abc"),
			session,
		)
	}

	@Test
	fun fallsBackToTheSessionCookieWhenTheBodyHasNoToken() = runTest {
		val client = clientWith {
			respond(
				content = """{"user":{"id":"usr_123","email":"santi@ignit.ar","name":"Santi"}}""",
				status = HttpStatusCode.OK,
				headers = headersOf(
					HttpHeaders.SetCookie,
					"better-auth.session_token=tok_cookie; Path=/; HttpOnly",
				),
			)
		}

		val session = KtorAuthGateway(client, BASE_URL).signIn("santi@ignit.ar", "secreto123")

		assertEquals("tok_cookie", session.token)
		assertEquals("usr_123", session.userId)
		assertEquals("santi@ignit.ar", session.email)
		assertEquals("Santi", session.name)
	}

	@Test
	fun storesTheSessionCookiePairAsTheCredential() = runTest {
		val client = clientWith {
			respond(
				content = """{"user":{"id":"usr_123","email":"santi@ignit.ar","name":"Santi"}}""",
				status = HttpStatusCode.OK,
				headers = headersOf(
					HttpHeaders.SetCookie,
					"__Secure-better-auth.session_token=signed.value; Path=/; HttpOnly; Secure",
				),
			)
		}

		val session = KtorAuthGateway(client, BASE_URL).signIn("santi@ignit.ar", "secreto123")

		assertEquals("__Secure-better-auth.session_token=signed.value", session.sessionCookie)
		assertEquals("signed.value", session.token)
	}

	@Test
	fun storesTheLocalSessionCookiePairToo() = runTest {
		val client = clientWith {
			respond(
				content = """{"user":{"id":"usr_123","email":"santi@ignit.ar","name":"Santi"}}""",
				status = HttpStatusCode.OK,
				headers = headersOf(
					HttpHeaders.SetCookie,
					"better-auth.session_token=signed.local; Path=/; HttpOnly",
				),
			)
		}

		val session = KtorAuthGateway(client, BASE_URL).signIn("santi@ignit.ar", "secreto123")

		assertEquals("better-auth.session_token=signed.local", session.sessionCookie)
		assertEquals("signed.local", session.token)
	}

	@Test
	fun bodyTokenStaysAndTheCookiePairIsKeptWhenBothArrive() = runTest {
		val client = clientWith {
			respond(
				content = """{"token":"tok_body","user":{"id":"usr_123","email":"santi@ignit.ar","name":"Santi"}}""",
				status = HttpStatusCode.OK,
				headers = headersOf(
					HttpHeaders.SetCookie,
					"__Secure-better-auth.session_token=signed.value; Path=/; HttpOnly; Secure",
				),
			)
		}

		val session = KtorAuthGateway(client, BASE_URL).signIn("santi@ignit.ar", "secreto123")

		assertEquals("tok_body", session.token)
		assertEquals("__Secure-better-auth.session_token=signed.value", session.sessionCookie)
	}

	@Test
	fun bodyOnlyResponseLeavesTheSessionCookieEmpty() = runTest {
		val client = clientWith {
			respond(
				content = """{"token":"tok_abc","user":{"id":"usr_123","email":"santi@ignit.ar","name":"Santi"}}""",
				status = HttpStatusCode.OK,
			)
		}

		val session = KtorAuthGateway(client, BASE_URL).signIn("santi@ignit.ar", "secreto123")

		assertEquals("tok_abc", session.token)
		assertEquals("", session.sessionCookie)
	}

	@Test
	fun failsWhenNoTokenCanBeFoundAtAll() = runTest {
		val client = clientWith {
			respond(
				content = """{"user":{"id":"usr_123","email":"santi@ignit.ar","name":"Santi"}}""",
				status = HttpStatusCode.OK,
			)
		}

		val failure = assertFailsWith<AuthException> {
			KtorAuthGateway(client, BASE_URL).signIn("santi@ignit.ar", "secreto123")
		}
		assertEquals(SPANISH_SIGN_IN_FALLBACK, failure.message)
	}

	@Test
	fun surfacesTheBackendMessageOn401() = runTest {
		val client = clientWith {
			respond(
				content = """{"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}""",
				status = HttpStatusCode.Unauthorized,
			)
		}

		val failure = assertFailsWith<AuthException> {
			KtorAuthGateway(client, BASE_URL).signIn("santi@ignit.ar", "wrong")
		}
		assertEquals("Invalid email or password", failure.message)
	}

	@Test
	fun fallsBackToSpanishOnANonJsonError() = runTest {
		val client = clientWith {
			respond(content = "<html>boom</html>", status = HttpStatusCode.InternalServerError)
		}

		val failure = assertFailsWith<AuthException> {
			KtorAuthGateway(client, BASE_URL).signIn("santi@ignit.ar", "secreto123")
		}
		assertEquals(SPANISH_SIGN_IN_FALLBACK, failure.message)
	}

	@Test
	fun wrapsTransportFailuresAsAuthException() = runTest {
		val client = clientWith { throw IOException("connection reset") }

		val failure = assertFailsWith<AuthException> {
			KtorAuthGateway(client, BASE_URL).signIn("santi@ignit.ar", "secreto123")
		}
		assertEquals("No pudimos conectar con el servidor.", failure.message)
	}
}
