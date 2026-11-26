// core/domain: entity test. Pins how a page decides whether another page exists.
package dev.ignit.domain.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private fun book(id: String) = Book(id = id, title = "Libro $id", roomId = "", totalPages = 0)

class BookPageTest {
	@Test
	fun pageCarriesTheServerTotals() {
		val page = BookPage(items = listOf(book("1"), book("2")), total = 24, offset = 12, limit = 12)

		assertEquals(listOf("1", "2"), page.items.map { it.id })
		assertEquals(24, page.total)
		assertEquals(12, page.offset)
		assertEquals(12, page.limit)
	}

	@Test
	fun hasMoreIsTrueWhenMorePagesRemain() {
		val page = BookPage(items = List(12) { book(it.toString()) }, total = 24, offset = 0, limit = 12)

		assertTrue(page.hasMore)
	}

	@Test
	fun hasMoreIsFalseOnTheLastPage() {
		val page = BookPage(items = List(12) { book(it.toString()) }, total = 24, offset = 12, limit = 12)

		assertFalse(page.hasMore)
	}

	@Test
	fun hasMoreIsFalseForAnEmptyPage() {
		val page = BookPage(items = emptyList(), total = 0, offset = 0, limit = 12)

		assertFalse(page.hasMore)
	}

	@Test
	fun hasMoreIsFalseWhenTotalEqualsOffsetPlusItems() {
		val page = BookPage(items = List(3) { book(it.toString()) }, total = 15, offset = 12, limit = 12)

		assertEquals(15, page.offset + page.items.size)
		assertFalse(page.hasMore)
	}
}
