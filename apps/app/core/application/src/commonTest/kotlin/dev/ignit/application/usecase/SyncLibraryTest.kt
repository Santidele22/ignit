// core/application: use case test. SyncLibrary forwards the page request to the port.
package dev.ignit.application.usecase

import dev.ignit.application.port.LibraryRepository
import dev.ignit.domain.model.Book
import dev.ignit.domain.model.BookPage
import kotlinx.coroutines.test.runTest
import kotlin.coroutines.cancellation.CancellationException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

private val catalogBook = Book(
	id = "7",
	title = "Clean Architecture",
	roomId = "",
	totalPages = 0,
)

private val firstPage = BookPage(items = listOf(catalogBook), total = 24, offset = 0, limit = 12)

/** One request the use case handed to the port. */
private data class PortCall(val mine: Boolean, val kind: String?, val limit: Int, val offset: Int)

/** Records every request the use case hands to the port. */
private class RecordingLibrary(private val result: Result<BookPage>) : LibraryRepository {
	val calls = mutableListOf<PortCall>()

	override suspend fun fetchLibrary(mine: Boolean, kind: String?, limit: Int, offset: Int): BookPage {
		calls += PortCall(mine, kind, limit, offset)
		return result.getOrThrow()
	}
}

class SyncLibraryTest {
	@Test
	fun defaultCallAsksForTheFirstPageOfThePublicCatalog() = runTest {
		val library = RecordingLibrary(Result.success(firstPage))

		val page = SyncLibrary(library)()

		assertEquals(firstPage, page.getOrThrow())
		assertEquals(listOf(PortCall(false, null, 12, 0)), library.calls)
	}

	@Test
	fun requestedLimitAndOffsetReachThePort() = runTest {
		val library = RecordingLibrary(Result.success(firstPage))

		SyncLibrary(library)(limit = 6, offset = 18)

		assertEquals(listOf(PortCall(false, null, 6, 18)), library.calls)
	}

	@Test
	fun defaultPageSizeIsTwelve() {
		assertEquals(12, LibraryRepository.DEFAULT_PAGE_SIZE)
	}

	@Test
	fun mineIsForwardedToThePort() = runTest {
		val library = RecordingLibrary(Result.success(firstPage))

		SyncLibrary(library)(mine = true)

		assertEquals(listOf(PortCall(true, null, 12, 0)), library.calls)
	}

	@Test
	fun blankKindBecomesNull() = runTest {
		val library = RecordingLibrary(Result.success(firstPage))

		SyncLibrary(library)(kind = "   ")

		assertEquals(listOf(PortCall(false, null, 12, 0)), library.calls)
	}

	@Test
	fun nonBlankKindIsForwardedVerbatim() = runTest {
		val library = RecordingLibrary(Result.success(firstPage))

		SyncLibrary(library)(mine = true, kind = " no_tecnico ")

		assertEquals(listOf(PortCall(true, " no_tecnico ", 12, 0)), library.calls)
	}

	@Test
	fun portFailureBecomesResultFailure() = runTest {
		val library = RecordingLibrary(Result.failure(IllegalStateException("boom")))

		val result = SyncLibrary(library)()

		assertTrue(result.isFailure)
	}

	@Test
	fun nonPositiveLimitIsRejectedBeforeThePortIsTouched() = runTest {
		val library = RecordingLibrary(Result.success(firstPage))

		val result = SyncLibrary(library)(limit = 0)

		assertIs<IllegalArgumentException>(result.exceptionOrNull())
		assertTrue(library.calls.isEmpty())
	}

	@Test
	fun negativeOffsetIsRejectedBeforeThePortIsTouched() = runTest {
		val library = RecordingLibrary(Result.success(firstPage))

		val result = SyncLibrary(library)(offset = -1)

		assertIs<IllegalArgumentException>(result.exceptionOrNull())
		assertTrue(library.calls.isEmpty())
	}

	@Test
	fun portCancellationIsReportedAsAFailureLikeToday() = runTest {
		val library = RecordingLibrary(Result.failure(CancellationException("cancelled")))

		val result = SyncLibrary(library)()

		assertIs<CancellationException>(result.exceptionOrNull())
	}
}
