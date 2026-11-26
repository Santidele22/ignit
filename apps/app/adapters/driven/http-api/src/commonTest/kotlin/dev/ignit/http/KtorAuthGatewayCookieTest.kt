// adapters/driven/http-api: test. The production backend prefixes the session cookie with __Secure-.
package dev.ignit.http

import dev.ignit.domain.model.AuthException
import dev.ignit.domain.model.UserSession
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

private const val BASE_URL = "https://ignit.ignit677.workers.dev"
private const val SIGN_IN_PATH = "/api/auth/sign-in/email"

private const val USER_JSON = """{"user":{"id":"usr_1","email":"a@b.ar","name":"A"}}"""

private fun clientReturning(
	vararg cookies: String,
	body: String = USER_JSON,
	status: HttpStatusCode = HttpStatusCode.OK,
): HttpClient = HttpClient(MockEngine {
	respond(
		content = body,
		status = status,
		headers = headersOf(HttpHeaders.SetCookie, cookies.toList()),
	)
}) { expectSuccess = false }

class KtorAuthGatewayCookieTest {
	@Test
	fun securePrefixedCookieIsAcceptedOutsideLocalhost() = runTest {
		val client = clientReturning("__Secure-better-auth.session_token=tok_secure; Path=/; HttpOnly; Secure")

		val session: UserSession = KtorAuthGateway(client, BASE_URL, SIGN_IN_PATH).signIn("a@b.ar", "pw")

		assertEquals("tok_secure", session.token)
		assertEquals("__Secure-better-auth.session_token=tok_secure", session.sessionCookie)
	}

	@Test
	fun unprefixedCookieIsStillAccepted() = runTest {
		val client = clientReturning("better-auth.session_token=tok_local; Path=/; HttpOnly")

		val session = KtorAuthGateway(client, BASE_URL, SIGN_IN_PATH).signIn("a@b.ar", "pw")

		assertEquals("tok_local", session.token)
		assertEquals("better-auth.session_token=tok_local", session.sessionCookie)
	}

	@Test
	fun theSessionCookieIsCapturedEvenWhenItArrivesSecond() = runTest {
		val client = clientReturning(
			"analytics_id=abc123; Path=/; Max-Age=86400",
			"__Secure-better-auth.session_token=tok_second; Path=/; HttpOnly; Secure",
		)

		val session = KtorAuthGateway(client, BASE_URL, SIGN_IN_PATH).signIn("a@b.ar", "pw")

		assertEquals("__Secure-better-auth.session_token=tok_second", session.sessionCookie)
		assertEquals("tok_second", session.token)
	}

	@Test
	fun unrelatedCookieDoesNotBecomeTheToken() = runTest {
		val client = clientReturning("analytics_id=abc123; Path=/")

		assertFailsWith<AuthException> { KtorAuthGateway(client, BASE_URL, SIGN_IN_PATH).signIn("a@b.ar", "pw") }
	}
}
