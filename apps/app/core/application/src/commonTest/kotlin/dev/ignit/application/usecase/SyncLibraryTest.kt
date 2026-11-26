// core/application: use case test. SyncLibrary forwards the catalog filters to the port.
package dev.ignit.application.usecase

import dev.ignit.application.port.LibraryRepository
import dev.ignit.domain.model.Book
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private val catalogBook = Book(
	id = "7",
	title = "Clean Architecture",
	roomId = "",
	totalPages = 0,
)

/** Records every `(mine, kind)` pair the use case hands to the port. */
private class RecordingLibrary(private val result: Result<List<Book>>) : LibraryRepository {
	val calls = mutableListOf<Pair<Boolean, String?>>()

	override suspend fun fetchLibrary(mine: Boolean, kind: String?): List<Book> {
		calls += mine to kind
		return result.getOrThrow()
	}
}

class SyncLibraryTest {
	@Test
	fun defaultCallAsksForThePublicCatalog() = runTest {
		val library = RecordingLibrary(Result.success(listOf(catalogBook)))

		val books = SyncLibrary(library)()

		assertEquals(listOf(catalogBook), books.getOrThrow())
		assertEquals(listOf<Pair<Boolean, String?>>(false to null), library.calls)
	}

	@Test
	fun mineIsForwardedToThePort() = runTest {
		val library = RecordingLibrary(Result.success(emptyList()))

		SyncLibrary(library)(mine = true)

		assertEquals(listOf<Pair<Boolean, String?>>(true to null), library.calls)
	}

	@Test
	fun blankKindBecomesNull() = runTest {
		val library = RecordingLibrary(Result.success(emptyList()))

		SyncLibrary(library)(kind = "   ")

		assertEquals(listOf<Pair<Boolean, String?>>(false to null), library.calls)
	}

	@Test
	fun nonBlankKindIsForwardedVerbatim() = runTest {
		val library = RecordingLibrary(Result.success(emptyList()))

		SyncLibrary(library)(mine = true, kind = " no_tecnico ")

		assertEquals(listOf<Pair<Boolean, String?>>(true to " no_tecnico "), library.calls)
	}

	@Test
	fun portFailureBecomesResultFailure() = runTest {
		val library = RecordingLibrary(Result.failure(IllegalStateException("boom")))

		val result = SyncLibrary(library)()

		assertTrue(result.isFailure)
	}
}
