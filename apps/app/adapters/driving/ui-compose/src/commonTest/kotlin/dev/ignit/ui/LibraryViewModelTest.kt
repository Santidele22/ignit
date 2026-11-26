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
 *
 * [result] receives that same pair, so a test can make two concurrent requests answer differently.
 * [gate] is read when a call starts, so replacing it between two launches gates each request on
 * its own deferred and lets the test decide which answer arrives first.
 */
private class RecordingLibrary : LibraryRepository {
	val calls = mutableListOf<Pair<Boolean, String?>>()
	var result: (Pair<Boolean, String?>) -> List<Book> = { emptyList() }
	var gate: CompletableDeferred<Unit>? = null

	override suspend fun fetchLibrary(mine: Boolean, kind: String?): List<Book> {
		val request = mine to kind
		calls += request
		gate?.await()
		return result(request)
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
	fun aLoadIssuedWhileAnotherIsInFlightIsNotDropped() = runTest {
		val firstGate = CompletableDeferred<Unit>()
		val secondGate = CompletableDeferred<Unit>()
		val library = RecordingLibrary()
		library.result = { request ->
			if (request.second == "tecnico") listOf(book("second")) else listOf(book("first"))
		}
		val viewModel = LibraryViewModel(SyncLibrary(library))

		library.gate = firstGate
		val first = launch { viewModel.load() }
		runCurrent()
		assertTrue(viewModel.loading)

		// Tap the shelf while the catalog request is still in flight: it must reach the repository.
		viewModel.onKindChange("tecnico")
		library.gate = secondGate
		val second = launch { viewModel.load() }
		runCurrent()
		assertEquals(listOf(false to null, false to "tecnico"), library.calls)

		// The newest request answers first: its result is the one on screen.
		secondGate.complete(Unit)
		second.join()
		assertEquals(listOf(book("second")), viewModel.books)
		assertFalse(viewModel.loading)

		// The superseded request answers later and must not overwrite the newer state.
		firstGate.complete(Unit)
		first.join()
		assertEquals(listOf(book("second")), viewModel.books)
		assertNull(viewModel.error)
		assertFalse(viewModel.loading)
	}

	@Test
	fun aSupersededFailureDoesNotSurfaceItsError() = runTest {
		val firstGate = CompletableDeferred<Unit>()
		val secondGate = CompletableDeferred<Unit>()
		val library = RecordingLibrary()
		library.result = { request ->
			if (request.second == "tecnico") {
				listOf(book("second"))
			} else {
				throw AuthException("Sesión vencida")
			}
		}
		val viewModel = LibraryViewModel(SyncLibrary(library))

		library.gate = firstGate
		val first = launch { viewModel.load() }
		runCurrent()
		viewModel.onKindChange("tecnico")
		library.gate = secondGate
		val second = launch { viewModel.load() }
		runCurrent()

		secondGate.complete(Unit)
		second.join()
		firstGate.complete(Unit)
		first.join()

		assertEquals(listOf(book("second")), viewModel.books)
		assertNull(viewModel.error)
		assertFalse(viewModel.loading)
	}

	@Test
	fun switchingScopeDuringTheInitialLoadLoadsThePersonalLibrary() = runTest {
		val catalogGate = CompletableDeferred<Unit>()
		val mineGate = CompletableDeferred<Unit>()
		val library = RecordingLibrary()
		library.result = { request ->
			if (request.first) listOf(book("mine")) else listOf(book("catalog"))
		}
		val viewModel = LibraryViewModel(SyncLibrary(library))

		library.gate = catalogGate
		val catalog = launch { viewModel.load() }
		runCurrent()
		assertTrue(viewModel.loading)

		// "Mi biblioteca" while the public catalog is still loading: the newest request must win.
		viewModel.onScopeChange(LibraryScope.MINE)
		library.gate = mineGate
		val mine = launch { viewModel.load() }
		runCurrent()
		assertEquals(listOf<Pair<Boolean, String?>>(false to null, true to null), library.calls)

		// The catalog answer lands first and is discarded, leaving the state to the newer request.
		catalogGate.complete(Unit)
		catalog.join()
		assertEquals(emptyList<Book>(), viewModel.books)
		assertTrue(viewModel.loading)

		mineGate.complete(Unit)
		mine.join()
		assertEquals(listOf(book("mine")), viewModel.books)
		assertNull(viewModel.error)
		assertFalse(viewModel.loading)
	}

	@Test
	fun refreshKeepsTheBooksOnScreenUntilTheNewAnswerArrives() = runTest {
		val library = RecordingLibrary()
		library.result = { listOf(book("first")) }
		val viewModel = LibraryViewModel(SyncLibrary(library))
		viewModel.load()

		val gate = CompletableDeferred<Unit>()
		library.result = { listOf(book("second")) }
		library.gate = gate
		val refreshing = launch { viewModel.refresh() }
		runCurrent()

		// A refresh never empties the grid while the request is in flight.
		assertEquals(listOf(book("first")), viewModel.books)
		assertTrue(viewModel.loading)

		gate.complete(Unit)
		refreshing.join()
		assertEquals(listOf(book("second")), viewModel.books)
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
