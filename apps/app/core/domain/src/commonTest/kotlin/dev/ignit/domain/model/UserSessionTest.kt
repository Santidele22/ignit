// core/domain: entity test. Pins the shape carried across every login boundary.
package dev.ignit.domain.model

import kotlin.test.Test
import kotlin.test.assertEquals

class UserSessionTest {
	@Test
	fun sessionHoldsIdentityAndToken() {
		val session = UserSession(
			userId = "usr_123",
			email = "santi@ignit.ar",
			name = "Santi",
			token = "tok_abc",
		)

		assertEquals("usr_123", session.userId)
		assertEquals("santi@ignit.ar", session.email)
		assertEquals("Santi", session.name)
		assertEquals("tok_abc", session.token)
	}

	@Test
	fun authExceptionCarriesBackendMessage() {
		val error = AuthException("Invalid email or password")

		assertEquals("Invalid email or password", error.message)
	}
}
