// core/application: use case test. A fake store stands in for the platform preferences port.
package dev.ignit.application.usecase

import dev.ignit.application.port.Preferences
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

/** In-memory [Preferences] that keeps the exact keys it was written under. */
private class InMemoryPreferences(
	private val values: MutableMap<String, String> = mutableMapOf(),
) : Preferences {
	override suspend fun read(key: String): String? = values[key]

	override suspend fun write(key: String, value: String) {
		values[key] = value
	}

	fun keys(): Set<String> = values.keys.toSet()
}

/** Store whose reads fail the way a broken platform store does. */
private class UnreadablePreferences(private val error: Throwable) : Preferences {
	override suspend fun read(key: String): String? = throw error

	override suspend fun write(key: String, value: String) {
		throw error
	}
}

class PalettePreferenceTest {
	@Test
	fun loadWithoutStoredValueReturnsNull() = runTest {
		val preference = PalettePreference(InMemoryPreferences())

		assertNull(preference.load())
	}

	@Test
	fun saveThenLoadReturnsTheStoredPalette() = runTest {
		val preference = PalettePreference(InMemoryPreferences())

		preference.save("noche-azul")

		assertEquals("noche-azul", preference.load())
	}

	@Test
	fun saveWritesUnderThePaletteKey() = runTest {
		val store = InMemoryPreferences()
		val preference = PalettePreference(store)

		preference.save("noche-azul")

		assertEquals(setOf("palette"), store.keys())
		assertEquals("noche-azul", store.read("palette"))
		assertEquals("palette", PalettePreference.PALETTE_KEY)
	}

	@Test
	fun unreadableStoreReturnsNullInsteadOfThrowing() = runTest {
		val preference = PalettePreference(UnreadablePreferences(IllegalStateException("store is gone")))

		assertNull(preference.load())
	}

	@Test
	fun cancellationFromTheStoreStillPropagates() = runTest {
		val preference = PalettePreference(UnreadablePreferences(CancellationException("cancelled")))

		assertFailsWith<CancellationException> { preference.load() }
	}
}
