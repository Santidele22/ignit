// core/domain: entity test. Pins the catalog fields the books API actually returns.
package dev.ignit.domain.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BookTest {
	@Test
	fun bookHoldsCoreProperties() {
		val book = Book(
			id = "book-1",
			title = "Clean Architecture",
			roomId = "estudio",
			totalPages = 320,
		)
		assertEquals("book-1", book.id)
		assertEquals("Clean Architecture", book.title)
		assertEquals("estudio", book.roomId)
		assertEquals(320, book.totalPages)
	}

	@Test
	fun bookCarriesTheCatalogFields() {
		val book = Book(
			id = "12",
			title = "Clean Architecture",
			roomId = "",
			totalPages = 0,
			author = "Robert C. Martin",
			kind = "tecnico",
			coverUrl = "https://covers.test/clean-architecture.jpg",
			published = true,
		)

		assertEquals("Robert C. Martin", book.author)
		assertEquals("tecnico", book.kind)
		assertEquals("https://covers.test/clean-architecture.jpg", book.coverUrl)
		assertTrue(book.published)
	}

	@Test
	fun catalogFieldsDefaultToSafeValues() {
		val book = Book(
			id = "book-1",
			title = "Clean Architecture",
			roomId = "estudio",
			totalPages = 320,
		)

		assertEquals("", book.author)
		assertEquals("", book.kind)
		assertNull(book.coverUrl)
		assertFalse(book.published)
	}
}
