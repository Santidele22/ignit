// adapters/driving/ui-compose: test. The view model is a plain class, so it runs without a UI harness.
package dev.ignit.ui

import dev.ignit.application.port.LibraryRepository
import dev.ignit.application.usecase.SyncLibrary
import dev.ignit.domain.model.AuthException
import dev.ignit.domain.model.Book
import dev.ignit.domain.model.BookPage
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

/** [count] consecutive books numbered from [from], so a page's contents are obvious in a failure. */
private fun books(from: Int, count: Int, kind: String = "") =
	List(count) { index -> book("${from + index}", kind) }

/** One page whose `total` defaults to what it carries, i.e. the last page of a short catalog. */
private fun page(items: List<Book>, total: Int = items.size, offset: Int = 0) =
	BookPage(items = items, total = total, offset = offset, limit = LibraryRepository.DEFAULT_PAGE_SIZE)

/**
 * One request the view model made, exactly as the backend would have received it. Paging is a wire
 * contract, so the tests assert the pairs `(mine, kind, limit, offset)` instead of internal state.
 */
private data class LibraryCall(
	val mine: Boolean,
	val kind: String?,
	val limit: Int,
	val offset: Int,
)

private fun call(
	mine: Boolean = false,
	kind: String? = null,
	offset: Int = 0,
	limit: Int = LibraryRepository.DEFAULT_PAGE_SIZE,
) = LibraryCall(mine = mine, kind = kind, limit = limit, offset = offset)

/**
 * Port fake that records every request so the tests assert what the backend would have been asked.
 *
 * [result] receives that same request, so a test can make two concurrent requests answer differently
 * and can answer per offset. [gate] is read when a call starts, so replacing it between two launches
 * gates each request on its own deferred and lets the test decide which answer arrives first.
 */
private class RecordingLibrary : LibraryRepository {
	val calls = mutableListOf<LibraryCall>()
	var result: (LibraryCall) -> BookPage = { page(emptyList()) }
	var gate: CompletableDeferred<Unit>? = null

	override suspend fun fetchLibrary(mine: Boolean, kind: String?, limit: Int, offset: Int): BookPage {
		val request = LibraryCall(mine = mine, kind = kind, limit = limit, offset = offset)
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

		assertEquals(listOf(call()), library.calls)
	}

	@Test
	fun selectingMineScopeLoadsThePersonalLibrary() = runTest {
		val library = RecordingLibrary()
		val viewModel = LibraryViewModel(SyncLibrary(library))

		viewModel.onScopeChange(LibraryScope.MINE)
		viewModel.load()

		assertEquals(listOf(call(mine = true)), library.calls)
	}

	@Test
	fun kindSelectionIsForwardedToTheRepository() = runTest {
		val library = RecordingLibrary()
		val viewModel = LibraryViewModel(SyncLibrary(library))

		viewModel.onKindChange("tecnico")
		viewModel.load()

		assertEquals(listOf(call(kind = "tecnico")), library.calls)
	}

	@Test
	fun failureKeepsThePreviousBooksAndSurfacesTheBackendMessage() = runTest {
		val library = RecordingLibrary()
		library.result = { page(listOf(book("1"), book("2"))) }
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

		library.result = { page(listOf(book("1"))) }
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
			if (request.kind == "tecnico") page(listOf(book("second"))) else page(listOf(book("first")))
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
		assertEquals(listOf(call(), call(kind = "tecnico")), library.calls)

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
			if (request.kind == "tecnico") {
				page(listOf(book("second")))
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
			if (request.mine) page(listOf(book("mine"))) else page(listOf(book("catalog")))
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
		assertEquals(listOf(call(), call(mine = true)), library.calls)

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
		library.result = { page(listOf(book("first"))) }
		val viewModel = LibraryViewModel(SyncLibrary(library))
		viewModel.load()

		val gate = CompletableDeferred<Unit>()
		library.result = { page(listOf(book("second"))) }
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
			page(
				listOf(
					book("1", kind = "tecnico"),
					book("2", kind = "terror_scifi"),
					book("3", kind = "tecnico"),
					book("4", kind = "   "),
				),
			)
		}
		val viewModel = LibraryViewModel(SyncLibrary(library))

		viewModel.load()

		assertEquals(listOf("tecnico", "terror_scifi"), viewModel.availableKinds)
	}

	@Test
	fun failureKeepsThePreviouslyDerivedKinds() = runTest {
		val library = RecordingLibrary()
		library.result = { page(listOf(book("1", kind = "tecnico"), book("2", kind = "poesia"))) }
		val viewModel = LibraryViewModel(SyncLibrary(library))
		viewModel.load()

		library.result = { throw AuthException("Se cayó la red") }
		viewModel.load()

		// A failed load leaves `books` untouched, so the chips keep the shelves already on screen.
		assertEquals(listOf("poesia", "tecnico"), viewModel.availableKinds)
	}

	@Test
	fun initialLoadRequestsTheFirstPageAndFillsThePageState() = runTest {
		val library = RecordingLibrary()
		library.result = { page(books(1, 12), total = 30) }
		val viewModel = LibraryViewModel(SyncLibrary(library))

		viewModel.load()

		assertEquals(listOf(call(offset = 0)), library.calls)
		assertEquals(books(1, 12), viewModel.books)
		assertEquals(30, viewModel.total)
		assertTrue(viewModel.hasMore)
		assertFalse(viewModel.loading)
	}

	@Test
	fun loadMoreRequestsTheNextOffsetAndAppendsThePage() = runTest {
		val library = RecordingLibrary()
		library.result = { request ->
			if (request.offset == 0) {
				page(books(1, 12), total = 30)
			} else {
				page(books(13, 12), total = 30, offset = 12)
			}
		}
		val viewModel = LibraryViewModel(SyncLibrary(library))
		viewModel.load()

		viewModel.loadMore()

		assertEquals(listOf(call(offset = 0), call(offset = 12)), library.calls)
		assertEquals(books(1, 24), viewModel.books)
		assertEquals(30, viewModel.total)
		assertTrue(viewModel.hasMore)
		assertFalse(viewModel.loadingMore)
	}

	@Test
	fun loadMoreIsANoOpOnTheLastPage() = runTest {
		val library = RecordingLibrary()
		library.result = { page(books(1, 12), total = 12) }
		val viewModel = LibraryViewModel(SyncLibrary(library))
		viewModel.load()

		viewModel.loadMore()

		assertEquals(listOf(call(offset = 0)), library.calls)
		assertFalse(viewModel.hasMore)
		assertFalse(viewModel.loadingMore)
	}

	@Test
	fun loadMoreIsANoOpWhileAFreshLoadIsInFlight() = runTest {
		val gate = CompletableDeferred<Unit>()
		val library = RecordingLibrary()
		library.result = { page(books(1, 12), total = 30) }
		val viewModel = LibraryViewModel(SyncLibrary(library))

		library.gate = gate
		val loading = launch { viewModel.load() }
		runCurrent()

		viewModel.loadMore()

		assertEquals(listOf(call(offset = 0)), library.calls)
		assertFalse(viewModel.loadingMore)

		gate.complete(Unit)
		loading.join()
	}

	@Test
	fun selectingAFilterKeepsEveryCatalogShelfAvailable() = runTest {
		val library = RecordingLibrary()
		library.result = {
			page(
				listOf(
					book("1", kind = "tecnico"),
					book("2", kind = "terror_scifi"),
					book("3", kind = "poesia"),
				),
			)
		}
		val viewModel = LibraryViewModel(SyncLibrary(library))
		viewModel.load()
		val everyShelf = listOf("poesia", "tecnico", "terror_scifi")
		assertEquals(everyShelf, viewModel.availableKinds)

		// The filtered answer only carries the chosen shelf; the user must still be able to switch away.
		viewModel.onKindChange("tecnico")
		library.result = { page(listOf(book("1", kind = "tecnico"))) }
		viewModel.load()

		assertEquals(listOf(book("1", kind = "tecnico")), viewModel.books)
		assertEquals(everyShelf, viewModel.availableKinds)
	}

	@Test
	fun aMineLoadDoesNotShrinkTheCatalogShelves() = runTest {
		val library = RecordingLibrary()
		library.result = {
			page(listOf(book("1", kind = "tecnico"), book("2", kind = "poesia")), total = 5)
		}
		val viewModel = LibraryViewModel(SyncLibrary(library))
		viewModel.load()
		val everyShelf = listOf("poesia", "tecnico")

		viewModel.onScopeChange(LibraryScope.MINE)
		library.result = { page(listOf(book("9", kind = "ficcion"))) }
		viewModel.load()

		assertEquals(listOf(book("9", kind = "ficcion")), viewModel.books)
		assertEquals(everyShelf, viewModel.availableKinds)
	}

	@Test
	fun appendedPagesDoNotDuplicateARepeatedBook() = runTest {
		val library = RecordingLibrary()
		library.result = { request ->
			if (request.offset == 0) {
				page(listOf(book("1"), book("2")), total = 3)
			} else {
				// The catalog shifted between requests, so the last row of page one came back again.
				page(listOf(book("2"), book("3")), total = 3, offset = 2)
			}
		}
		val viewModel = LibraryViewModel(SyncLibrary(library))
		viewModel.load()

		viewModel.loadMore()

		assertEquals(listOf(call(offset = 0), call(offset = 2)), library.calls)
		assertEquals(listOf(book("1"), book("2"), book("3")), viewModel.books)
	}

	@Test
	fun aFailedLoadMoreKeepsTheRowsAndSurfacesTheError() = runTest {
		val library = RecordingLibrary()
		library.result = { request ->
			if (request.offset == 0) page(books(1, 12), total = 30) else throw AuthException("Se cayó la red")
		}
		val viewModel = LibraryViewModel(SyncLibrary(library))
		viewModel.load()

		viewModel.loadMore()

		assertEquals(listOf(call(offset = 0), call(offset = 12)), library.calls)
		assertEquals(books(1, 12), viewModel.books)
		assertEquals("Se cayó la red", viewModel.error)
		assertFalse(viewModel.loadingMore)
	}

	@Test
	fun aSupersededLoadMoreDoesNotAppend() = runTest {
		val gate = CompletableDeferred<Unit>()
		val library = RecordingLibrary()
		library.result = { request ->
			if (request.offset == 0) {
				page(books(1, 12), total = 30)
			} else {
				page(books(13, 12), total = 30, offset = 12)
			}
		}
		val viewModel = LibraryViewModel(SyncLibrary(library))
		viewModel.load()

		library.gate = gate
		val appending = launch { viewModel.loadMore() }
		runCurrent()
		assertEquals(listOf(call(offset = 0), call(offset = 12)), library.calls)
		assertTrue(viewModel.loadingMore)

		// Switch scope while the extra page is still in flight: its answer belongs to the old request.
		viewModel.onScopeChange(LibraryScope.MINE)
		library.gate = null
		library.result = { page(listOf(book("mine"))) }
		viewModel.load()
		assertEquals(listOf(book("mine")), viewModel.books)

		gate.complete(Unit)
		appending.join()

		assertEquals(listOf(book("mine")), viewModel.books)
		assertNull(viewModel.error)
		assertFalse(viewModel.loadingMore)
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
