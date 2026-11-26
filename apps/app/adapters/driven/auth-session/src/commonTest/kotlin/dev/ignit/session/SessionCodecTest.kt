// adapters/driven/auth-session: shared session codec contract.
package dev.ignit.session

import dev.ignit.domain.model.UserSession
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SessionCodecTest {
	private val session = UserSession(
		userId = "usr_123",
		email = "santi@ignit.ar",
		name = "Santi",
		token = "tok_abc",
	)

	@Test
	fun roundTripPreservesEveryField() {
		val encoded = SessionCodec.encode(session)

		assertEquals(session, SessionCodec.decode(encoded))
	}

	@Test
	fun roundTripPreservesAwkwardCharacters() {
		val awkward = session.copy(name = "Say \"hi\" — Ñandú 🚀")

		assertEquals(awkward, SessionCodec.decode(SessionCodec.encode(awkward)))
	}

	@Test
	fun roundTripPreservesTheSessionCookiePair() {
		val withCookie = session.copy(
			sessionCookie = "__Secure-better-auth.session_token=signed.value",
		)

		assertEquals(withCookie, SessionCodec.decode(SessionCodec.encode(withCookie)))
	}

	@Test
	fun legacyPayloadWithoutTheSessionCookieStillDecodes() {
		val raw = """{"userId":"usr_123","email":"santi@ignit.ar","name":"Santi","token":"tok_abc"}"""

		val decoded = SessionCodec.decode(raw)

		assertEquals(session, decoded)
		assertEquals("", decoded?.sessionCookie)
	}

	@Test
	fun nullSessionCookieDecodesToAnEmptyString() {
		val raw = """{"userId":"usr_123","email":"santi@ignit.ar","name":"Santi","token":"tok_abc",""" +
			""""sessionCookie":null}"""

		assertEquals(session, SessionCodec.decode(raw))
	}

	@Test
	fun malformedJsonDecodesToNull() {
		assertNull(SessionCodec.decode("{"))
		assertNull(SessionCodec.decode("""{"userId": "usr_123", """))
		assertNull(SessionCodec.decode("not json at all"))
		assertNull(SessionCodec.decode(""))
	}

	@Test
	fun missingRequiredFieldDecodesToNull() {
		assertNull(
			SessionCodec.decode("""{"userId":"usr_123","email":"santi@ignit.ar","name":"Santi"}"""),
		)
	}

	@Test
	fun nonStringFieldDecodesToNull() {
		assertNull(
			SessionCodec.decode(
				"""{"userId":7,"email":"santi@ignit.ar","name":"Santi","token":"tok_abc"}""",
			),
		)
	}

	@Test
	fun unknownFieldsAreIgnored() {
		val raw = """{"userId":"usr_123","email":"santi@ignit.ar","name":"Santi","token":"tok_abc",""" +
			""""expiresAt":42,"user":{"id":"usr_123","active":true}}"""

		assertEquals(session, SessionCodec.decode(raw))
	}
}
