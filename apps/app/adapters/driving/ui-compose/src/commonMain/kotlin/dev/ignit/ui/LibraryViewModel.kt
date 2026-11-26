// adapters/driving/ui-compose: driving adapter. Library state over the SyncLibrary use case — no Ktor, no storage.
package dev.ignit.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.ignit.application.usecase.SyncLibrary
import dev.ignit.domain.model.Book
import kotlinx.coroutines.CancellationException

/** Which shelf the screen shows: the public catalog or the signed-in user's own library. */
enum class LibraryScope { CATALOG, MINE }

/**
 * Compose-observable state of the library screen.
 *
 * Plain class on purpose (same convention as [LoginViewModel]): every write goes through a method,
 * so the screen never has to guard duplicate requests itself. The screen launches [load] and
 * [refresh], because a scope or kind change only records the choice here.
 */
class LibraryViewModel(private val syncLibrary: SyncLibrary) {
	var scope by mutableStateOf(LibraryScope.CATALOG)
		private set
	var kind by mutableStateOf<String?>(null)
		private set
	var books by mutableStateOf<List<Book>>(emptyList())
		private set
	var loading by mutableStateOf(false)
		private set
	var error by mutableStateOf<String?>(null)
		private set

	/**
	 * Shelves the currently loaded [books] actually carry, deduplicated and sorted so the chips do
	 * not shuffle between loads. Derived from [books], so it follows every successful load and
	 * keeps the shelves already on screen when a later load fails.
	 */
	val availableKinds: List<String>
		get() = books.mapNotNull { book -> book.kind.trim().takeIf(String::isNotBlank) }
			.distinct()
			.sorted()

	/** Loads the current [scope] and [kind]; re-entrant calls while [loading] are ignored. */
	suspend fun load() {
		fetch()
	}

	/**
	 * Same request as [load], named for the manual refresh action. Neither path empties [books]
	 * before the response arrives, so a refresh keeps the grid on screen instead of flashing the
	 * empty state; a failure leaves the previous books untouched either way.
	 */
	suspend fun refresh() {
		fetch()
	}

	fun onScopeChange(value: LibraryScope) {
		scope = value
	}

	/** `null` means every shelf. */
	fun onKindChange(value: String?) {
		kind = value
	}

	/**
	 * One request. The use case wraps the port call in `runCatching`, so cancellation arrives as a
	 * failure whose cause is a [CancellationException]: rethrowing it keeps a screen that left the
	 * composition from painting an error it never earned.
	 */
	private suspend fun fetch() {
		if (loading) return

		loading = true
		try {
			syncLibrary(mine = scope == LibraryScope.MINE, kind = kind).fold(
				onSuccess = { loaded ->
					books = loaded
					error = null
				},
				onFailure = { failure ->
					if (failure is CancellationException) throw failure
					error = failure.message?.takeIf { it.isNotBlank() } ?: EMPTY_LIBRARY_ERROR
				},
			)
		} finally {
			loading = false
		}
	}

	companion object {
		/** Fallback for failures without a message, e.g. a dropped connection. */
		const val EMPTY_LIBRARY_ERROR: String = "No pudimos cargar la biblioteca."

		/** Spanish labels of the shelves the backend publishes today. */
		private val KNOWN_KIND_LABELS: Map<String, String> = mapOf(
			"tecnico" to "Técnico",
			"terror_scifi" to "Terror / Sci-Fi",
			"filosofia" to "Filosofía",
			"ficcion" to "Ficción",
			"poesia" to "Poesía",
		)

		/**
		 * Chip text for a `kind` value: the published Spanish label when there is one, otherwise the
		 * raw value humanized (`novela_negra` -> "Novela negra"). Blank values have no chip.
		 */
		fun kindLabel(kind: String): String {
			val normalized = kind.trim()
			if (normalized.isEmpty()) return ""
			return KNOWN_KIND_LABELS[normalized]
				?: normalized.replace('_', ' ').trim()
					.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
		}
	}
}
