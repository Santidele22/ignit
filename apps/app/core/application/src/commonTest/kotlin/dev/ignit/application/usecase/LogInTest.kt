// core/application: use case test. Fakes stand in for the network and the storage ports.
package dev.ignit.application.usecase

import dev.ignit.application.port.AuthGateway
import dev.ignit.application.port.AuthSession
import dev.ignit.domain.model.AuthException
import dev.ignit.domain.model.UserSession
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The production sign-in shape: a body token and no usable session cookie.
 *
 * Production runs `session-mode = neon`, whose guard reads only `Authorization: Bearer <token>`, so
 * a session that arrives without a cookie is still a usable session and must be stored as-is.
 */
private val santi = UserSession(
	userId = "usr_123",
	email = "santi@ignit.ar",
	name = "Santi",
	token = "tok_abc",
)

private class RecordingGateway(
	private val result: Result<UserSession>,
) : AuthGateway {
	val calls = mutableListOf<Pair<String, String>>()

	override suspend fun signIn(email: String, password: String): UserSession {
		calls += email to password
		return result.getOrThrow()
	}
}

private class RecordingSession(private var stored: UserSession? = null) : AuthSession {
	var saves = 0
	var clears = 0

	fun current(): UserSession? = stored

	override suspend fun load(): UserSession? = stored

	override suspend fun save(session: UserSession) {
		saves += 1
		stored = session
	}

	override suspend fun clear() {
		clears += 1
		stored = null
	}
}

class LogInTest {
	@Test
	fun trimsEmailAndPersistsSessionOnSuccess() = runTest {
		val gateway = RecordingGateway(Result.success(santi))
		val session = RecordingSession()

		val result = LogIn(gateway, session)("  santi@ignit.ar  ", "secret123")

		assertTrue(result.isSuccess)
		assertEquals("santi@ignit.ar", gateway.calls.single().first)
		assertEquals("secret123", gateway.calls.single().second)
		assertEquals(santi, session.current())
		assertEquals(1, session.saves)
	}

	@Test
	fun blankEmailIsRejectedWithoutCallingTheNetwork() = runTest {
		val gateway = RecordingGateway(Result.success(santi))
		val session = RecordingSession()

		val result = LogIn(gateway, session)("   ", "secret123")

		assertTrue(result.isFailure)
		assertEquals("Ingresá tu email", result.exceptionOrNull()?.message)
		assertTrue(gateway.calls.isEmpty())
		assertNull(session.current())
		assertEquals(0, session.saves)
	}

	@Test
	fun blankPasswordIsRejectedWithoutCallingTheNetwork() = runTest {
		val gateway = RecordingGateway(Result.success(santi))
		val session = RecordingSession()

		val result = LogIn(gateway, session)("santi@ignit.ar", "   ")

		assertTrue(result.isFailure)
		assertEquals("Ingresá tu contraseña", result.exceptionOrNull()?.message)
		assertTrue(gateway.calls.isEmpty())
		assertNull(session.current())
		assertEquals(0, session.saves)
	}

	@Test
	fun rejectedCredentialsSurfaceTheBackendMessageAndPersistNothing() = runTest {
		val gateway = RecordingGateway(Result.failure(AuthException("Invalid email or password")))
		val session = RecordingSession()

		val result = LogIn(gateway, session)("santi@ignit.ar", "wrong")

		assertTrue(result.isFailure)
		assertEquals("Invalid email or password", result.exceptionOrNull()?.message)
		assertNull(session.current())
		assertEquals(0, session.saves)
		assertEquals(1, gateway.calls.size)
	}

	@Test
	fun failedLoginLeavesAPreviouslyStoredSessionUntouched() = runTest {
		val gateway = RecordingGateway(Result.failure(AuthException("Invalid email or password")))
		val session = RecordingSession(stored = santi)

		LogIn(gateway, session)("santi@ignit.ar", "wrong")

		assertEquals(santi, session.current())
		assertEquals(0, session.saves)
		assertEquals(0, session.clears)
	}

	@Test
	fun aSessionWithoutACookieStillLogsInAndPersists() = runTest {
		val cookieLess = santi.copy(sessionCookie = "")
		val gateway = RecordingGateway(Result.success(cookieLess))
		val session = RecordingSession()

		val result = LogIn(gateway, session)("santi@ignit.ar", "secret123")

		assertTrue(result.isSuccess)
		assertEquals(cookieLess, result.getOrNull())
		assertEquals(1, gateway.calls.size)
		assertEquals(cookieLess, session.current())
		assertEquals(1, session.saves)
	}

	@Test
	fun aBlankCookieSessionReplacesThePreviouslyStoredSession() = runTest {
		val blankCookie = santi.copy(sessionCookie = "   ")
		val gateway = RecordingGateway(Result.success(blankCookie))
		val session = RecordingSession(stored = santi.copy(sessionCookie = "stale.cookie"))

		val result = LogIn(gateway, session)("santi@ignit.ar", "secret123")

		assertTrue(result.isSuccess)
		assertEquals(blankCookie, session.current())
		assertEquals(1, session.saves)
		assertEquals(0, session.clears)
	}

	@Test
	fun aSessionWithACookieIsPersisted() = runTest {
		val signedIn = santi.copy(sessionCookie = "better-auth.session_token=fresh.signed")
		val gateway = RecordingGateway(Result.success(signedIn))
		val session = RecordingSession()

		val result = LogIn(gateway, session)("santi@ignit.ar", "secret123")

		assertTrue(result.isSuccess)
		assertEquals(signedIn, result.getOrNull())
		assertEquals("better-auth.session_token=fresh.signed", session.current()?.sessionCookie)
		assertEquals(1, session.saves)
	}
}
