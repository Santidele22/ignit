package dev.ignit.domain.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFails

class ReadingTest {
	@Test
	fun validatesPageAndPctBounds() {
		assertFails { ReadingProgress(bookId = "1", page = 0) }
		assertFails { ReadingProgress(bookId = "1", page = 1, pct = 1.2) }
		assertFails { ReadingProgress(bookId = " ", page = 1) }

		val p = ReadingProgress(bookId = "1", page = 5, pct = 0.25, updatedAtEpochMs = 100L)
		assertEquals(5, p.page)
	}

	@Test
	fun resolvesProgressConflictWithLastWriteWins() {
		val older = ReadingProgress(bookId = "1", page = 4, pct = 0.1, updatedAtEpochMs = 100L)
		val newer = ReadingProgress(bookId = "1", page = 12, pct = 0.5, updatedAtEpochMs = 200L)

		assertEquals(newer, resolveProgressConflict(older, newer))
		assertEquals(newer, resolveProgressConflict(newer, older))
		assertEquals(older, resolveProgressConflict(older, null))
		assertEquals(newer, resolveProgressConflict(null, newer))
	}
}
