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
 * [loadMore], because a scope or kind change only records the choice here.
 */
class LibraryViewModel(private val syncLibrary: SyncLibrary) {
	var scope by mutableStateOf(LibraryScope.CATALOG)
		private set
	var kind by mutableStateOf<String?>(null)
		private set
	var books by mutableStateOf<List<Book>>(emptyList())
		private set

	/** How many entries the server reports for the current [scope]/[kind], not just the loaded ones. */
	var total by mutableStateOf(0)
		private set

	/** True while the server holds entries past the last one in [books]. */
	var hasMore by mutableStateOf(false)
		private set

	/** A fresh load with no answer yet; the grid may still hold the previous rows. */
	var loading by mutableStateOf(false)
		private set

	/** A page being appended below the rows already on screen. */
	var loadingMore by mutableStateOf(false)
		private set
	var error by mutableStateOf<String?>(null)
		private set

	/**
	 * Every shelf the unfiltered public catalog carries, kept in its own state instead of being
	 * derived from [books].
	 *
	 * The user reported that choosing a filter made every other shelf disappear, leaving only
	 * "Todos": deriving this from the filtered rows is exactly that bug, because a page narrowed to
	 * `tecnico` only knows `tecnico`. So a page may add shelves here only when it was fetched from
	 * the complete catalog (public and unfiltered); a filtered page, a personal library page and a
	 * failure never write it, and it is only ever grown, never shrunk.
	 */
	var availableKinds by mutableStateOf<List<String>>(emptyList())
		private set

	/** Bumped by every fresh [load]/[refresh]: the highest value is the request allowed to write state. */
	private var generation = 0

	/** Loads the first page of the current [scope] and [kind]; a newer call supersedes one still in flight. */
	suspend fun load() {
		fetch(append = false)
	}

	/**
	 * Appends the page that follows [books]. A no-op while a page is already on its way, while the
	 * first page is still loading, or once the server says there is nothing left.
	 */
	suspend fun loadMore() {
		fetch(append = true)
	}

	/**
	 * Same request as [load], named for the manual refresh action. Neither path empties [books]
	 * before the response arrives, so a refresh keeps the grid on screen instead of flashing the
	 * empty state; a failure leaves the previous books untouched either way.
	 */
	suspend fun refresh() {
		fetch(append = false)
	}

	fun onScopeChange(value: LibraryScope) {
		scope = value
	}

	/** `null` means every shelf. */
	fun onKindChange(value: String?) {
		kind = value
	}

	/**
	 * One request: the first page (`append = false`) or the page after [books] (`append = true`).
	 *
	 * The newest fresh load always wins: every [load]/[refresh] takes the next [generation], and a
	 * page whose generation is stale by the time its answer arrives leaves [books], [error] and the
	 * loading flags to the newer call instead of overwriting them. An appended page shares the
	 * generation of the load it continues, so a scope or kind switch during an in-flight
	 * [loadMore] supersedes it too: it neither appends nor clears [loadingMore].
	 *
	 * Appending deduplicates by [Book.id] because the catalog can shift rows between pages, and a
	 * repeated key would crash the grid.
	 *
	 * The use case wraps the port call in `runCatching`, so cancellation arrives as a failure whose
	 * cause is a [CancellationException]: rethrowing it keeps a screen that left the composition from
	 * painting an error it never earned.
	 */
	private suspend fun fetch(append: Boolean) {
		// Captured before the call: the answer belongs to the request as it was written, even if the
		// user moved on while it was in flight.
		val requestMine = scope == LibraryScope.MINE
		val requestKind = kind
		if (append && (!hasMore || loading || loadingMore)) return
		val request = if (append) {
			loadingMore = true
			generation
		} else {
			loading = true
			loadingMore = false
			++generation
		}

		try {
			val outcome = syncLibrary(
				mine = requestMine,
				kind = requestKind,
				offset = if (append) books.size else 0,
			)
			outcome.exceptionOrNull()?.let { failure ->
				if (failure is CancellationException) throw failure
			}
			// A newer request owns the state: this answer is discarded even if it arrived first.
			if (request != generation) return
			outcome.fold(
				onSuccess = { loaded ->
					books = if (append) {
						(books + loaded.items).distinctBy { book -> book.id }
					} else {
						loaded.items.distinctBy { book -> book.id }
					}
					total = loaded.total
					hasMore = loaded.hasMore
					error = null
					// Only the complete catalog knows every shelf; see [availableKinds].
					if (!requestMine && requestKind == null) {
						val shelves = loaded.items
							.mapNotNull { book -> book.kind.trim().takeIf(String::isNotBlank) }
						availableKinds = (availableKinds + shelves).distinct().sorted()
					}
				},
				onFailure = { failure ->
					error = failure.message?.takeIf { it.isNotBlank() } ?: EMPTY_LIBRARY_ERROR
				},
			)
		} finally {
			if (request == generation) {
				if (append) loadingMore = false else loading = false
			}
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
