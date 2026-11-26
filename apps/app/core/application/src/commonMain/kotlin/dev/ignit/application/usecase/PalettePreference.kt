// core/application: use case. Reads and writes the palette choice over the preferences port.
package dev.ignit.application.usecase

import dev.ignit.application.port.Preferences
import kotlin.coroutines.cancellation.CancellationException

/**
 * Remembers which palette the user picked, so the next launch opens with it.
 *
 * [load] is total: an unreadable store reads as "nothing saved yet", because a broken preference
 * file must never keep the app from starting. [save] propagates storage failures: the UI already
 * applied the choice, so the adapter's own message is the one worth surfacing.
 */
class PalettePreference(private val preferences: Preferences) {

	/** Returns the stored palette name, or null when the user never picked one. */
	suspend fun load(): String? = try {
		preferences.read(PALETTE_KEY)
	} catch (cancellation: CancellationException) {
		throw cancellation
	} catch (unreadable: Exception) {
		null
	}

	/** Writes [palette] under [PALETTE_KEY]; failures reach the caller unchanged. */
	suspend fun save(palette: String) {
		preferences.write(PALETTE_KEY, palette)
	}

	companion object {
		const val PALETTE_KEY: String = "palette"
	}
}
