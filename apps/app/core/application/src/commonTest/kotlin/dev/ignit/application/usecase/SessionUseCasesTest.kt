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

/** A session persisted before the signed cookie was stored: it cannot authenticate anything. */
private val legacy = UserSession(
	userId = "usr_123",
	email = "santi@ignit.ar",
	name = "Santi",
	token = "tok_abc",
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
	fun aSessionWithoutItsCookieIsNotUsable() = runTest {
		assertNull(GetCurrentSession(FakeSession(legacy))())
	}

	@Test
	fun logOutClearsTheStoredSession() = runTest {
		val session = FakeSession(stored)

		LogOut(session)()

		assertNull(session.load())
		assertNull(GetCurrentSession(session)())
	}
}
