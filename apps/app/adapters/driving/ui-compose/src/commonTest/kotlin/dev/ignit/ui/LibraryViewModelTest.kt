// adapters/driving/ui-compose: test. The view model is a plain class, so it runs without a UI harness.
package dev.ignit.ui

import dev.ignit.application.port.LibraryRepository
import dev.ignit.application.usecase.SyncLibrary
import dev.ignit.domain.model.AuthException
import dev.ignit.domain.model.Book
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun book(id: String, kind: String = "") =
	Book(id = id, title = "Libro $id", roomId = "", totalPages = 0, kind = kind)

/**
 * Port fake that records every request as the `(mine, kind)` pair the use case forwarded, so the
 * tests assert what the backend would have been asked instead of internal state.
 */
private class RecordingLibrary : LibraryRepository {
	val calls = mutableListOf<Pair<Boolean, String?>>()
	var result: () -> List<Book> = { emptyList() }
	var gate: CompletableDeferred<Unit>? = null

	override suspend fun fetchLibrary(mine: Boolean, kind: String?): List<Book> {
		calls += mine to kind
		gate?.await()
		return result()
	}
}

// `runCurrent` is still behind the coroutines opt-in; the test coroutine is advanced deliberately.
@OptIn(ExperimentalCoroutinesApi::class)
class LibraryViewModelTest {
	@Test
	fun loadRequestsThePublicCatalogByDefault() = runTest {
		val library = RecordingLibrary()
		val viewModel = LibraryViewModel(SyncLibrary(library))

		viewModel.load()

		assertEquals(listOf<Pair<Boolean, String?>>(false to null), library.calls)
	}

	@Test
	fun selectingMineScopeLoadsThePersonalLibrary() = runTest {
		val library = RecordingLibrary()
		val viewModel = LibraryViewModel(SyncLibrary(library))

		viewModel.onScopeChange(LibraryScope.MINE)
		viewModel.load()

		assertEquals(listOf<Pair<Boolean, String?>>(true to null), library.calls)
	}

	@Test
	fun kindSelectionIsForwardedToTheRepository() = runTest {
		val library = RecordingLibrary()
		val viewModel = LibraryViewModel(SyncLibrary(library))

		viewModel.onKindChange("tecnico")
		viewModel.load()

		assertEquals(listOf<Pair<Boolean, String?>>(false to "tecnico"), library.calls)
	}

	@Test
	fun failureKeepsThePreviousBooksAndSurfacesTheBackendMessage() = runTest {
		val library = RecordingLibrary()
		library.result = { listOf(book("1"), book("2")) }
		val viewModel = LibraryViewModel(SyncLibrary(library))
		viewModel.load()

		library.result = { throw AuthException("Sesión vencida") }
		viewModel.load()

		assertEquals("Sesión vencida", viewModel.error)
		assertEquals(listOf(book("1"), book("2")), viewModel.books)
		assertFalse(viewModel.loading)
	}

	@Test
	fun blankFailureMessageFallsBackToTheSpanishText() = runTest {
		val library = RecordingLibrary()
		library.result = { throw AuthException("   ") }
		val viewModel = LibraryViewModel(SyncLibrary(library))

		viewModel.load()

		assertEquals("No pudimos cargar la biblioteca.", viewModel.error)
	}

	@Test
	fun successClearsThePreviousError() = runTest {
		val library = RecordingLibrary()
		library.result = { throw AuthException("Se cayó la red") }
		val viewModel = LibraryViewModel(SyncLibrary(library))
		viewModel.load()

		library.result = { listOf(book("1")) }
		viewModel.load()

		assertNull(viewModel.error)
		assertEquals(listOf(book("1")), viewModel.books)
	}

	@Test
	fun reentrantLoadIsIgnoredWhileLoading() = runTest {
		val gate = CompletableDeferred<Unit>()
		val library = RecordingLibrary().apply { this.gate = gate }
		val viewModel = LibraryViewModel(SyncLibrary(library))

		val first = launch { viewModel.load() }
		runCurrent()
		assertTrue(viewModel.loading)

		viewModel.load()

		gate.complete(Unit)
		first.join()
		assertEquals(1, library.calls.size)
		assertFalse(viewModel.loading)
	}

	@Test
	fun cancellationIsRethrownInsteadOfBecomingAnError() = runTest {
		val library = RecordingLibrary()
		library.result = { throw CancellationException("left the screen") }
		val viewModel = LibraryViewModel(SyncLibrary(library))

		assertFailsWith<CancellationException> { viewModel.load() }

		assertNull(viewModel.error)
		assertFalse(viewModel.loading)
	}

	@Test
	fun availableKindsIsEmptyBeforeAnyLoad() {
		val viewModel = LibraryViewModel(SyncLibrary(RecordingLibrary()))

		assertEquals(emptyList(), viewModel.availableKinds)
	}

	@Test
	fun availableKindsHoldsTheDistinctSortedNonBlankKindsLoaded() = runTest {
		val library = RecordingLibrary()
		library.result = {
			listOf(
				book("1", kind = "tecnico"),
				book("2", kind = "terror_scifi"),
				book("3", kind = "tecnico"),
				book("4", kind = "   "),
			)
		}
		val viewModel = LibraryViewModel(SyncLibrary(library))

		viewModel.load()

		assertEquals(listOf("tecnico", "terror_scifi"), viewModel.availableKinds)
	}

	@Test
	fun failureKeepsThePreviouslyDerivedKinds() = runTest {
		val library = RecordingLibrary()
		library.result = { listOf(book("1", kind = "tecnico"), book("2", kind = "poesia")) }
		val viewModel = LibraryViewModel(SyncLibrary(library))
		viewModel.load()

		library.result = { throw AuthException("Se cayó la red") }
		viewModel.load()

		// A failed load leaves `books` untouched, so the chips keep the shelves already on screen.
		assertEquals(listOf("poesia", "tecnico"), viewModel.availableKinds)
	}

	@Test
	fun kindLabelMapsTheKnownShelves() {
		assertEquals("Técnico", LibraryViewModel.kindLabel("tecnico"))
		assertEquals("Terror / Sci-Fi", LibraryViewModel.kindLabel("terror_scifi"))
		assertEquals("Filosofía", LibraryViewModel.kindLabel("filosofia"))
		assertEquals("Ficción", LibraryViewModel.kindLabel("ficcion"))
		assertEquals("Poesía", LibraryViewModel.kindLabel("poesia"))
	}

	@Test
	fun kindLabelHumanizesAnUnknownValue() {
		assertEquals("Novela negra", LibraryViewModel.kindLabel("novela_negra"))
	}

	@Test
	fun kindLabelIsEmptyForBlankValues() {
		assertEquals("", LibraryViewModel.kindLabel(""))
		assertEquals("", LibraryViewModel.kindLabel("   "))
	}
}
