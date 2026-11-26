// core/application: use case test. Session read and clear stay thin over the port.
package dev.ignit.application.usecase

import dev.ignit.application.port.AuthSession
import dev.ignit.domain.model.UserSession
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private val stored = UserSession(
	userId = "usr_123",
	email = "santi@ignit.ar",
	name = "Santi",
	token = "tok_abc",
	sessionCookie = "better-auth.session_token=tok_abc.sig",
)

/**
 * The production sign-in shape: a body token and no cookie, because `neon` mode authenticates the
 * bearer token only. It is a usable session.
 */
private val tokenOnly = UserSession(
	userId = "usr_123",
	email = "santi@ignit.ar",
	name = "Santi",
	token = "tok_abc",
)

/** The local-development shape: better-auth mounts a cookie session and it is usable on its own. */
private val cookieOnly = UserSession(
	userId = "usr_123",
	email = "santi@ignit.ar",
	name = "Santi",
	token = "",
	sessionCookie = "better-auth.session_token=tok_abc.sig",
)

/** No credential at all: the API would answer 401, so the app treats this as signed out. */
private val credentialless = UserSession(
	userId = "usr_123",
	email = "santi@ignit.ar",
	name = "Santi",
	token = "",
)

private class FakeSession(private var current: UserSession? = null) : AuthSession {
	override suspend fun load(): UserSession? = current

	override suspend fun save(session: UserSession) {
		current = session
	}

	override suspend fun clear() {
		current = null
	}
}

class SessionUseCasesTest {
	@Test
	fun currentSessionReturnsWhatThePortHolds() = runTest {
		assertEquals(stored, GetCurrentSession(FakeSession(stored))())
	}

	@Test
	fun currentSessionIsNullWhenNothingWasStored() = runTest {
		assertNull(GetCurrentSession(FakeSession())())
	}

	@Test
	fun aTokenOnlySessionIsUsable() = runTest {
		assertEquals(tokenOnly, GetCurrentSession(FakeSession(tokenOnly))())
	}

	@Test
	fun aCookieOnlySessionIsUsable() = runTest {
		assertEquals(cookieOnly, GetCurrentSession(FakeSession(cookieOnly))())
	}

	@Test
	fun aSessionWithNeitherCredentialIsSignedOut() = runTest {
		assertNull(GetCurrentSession(FakeSession(credentialless))())
	}

	@Test
	fun logOutClearsTheStoredSession() = runTest {
		val session = FakeSession(stored)

		LogOut(session)()

		assertNull(session.load())
		assertNull(GetCurrentSession(session)())
	}
}
