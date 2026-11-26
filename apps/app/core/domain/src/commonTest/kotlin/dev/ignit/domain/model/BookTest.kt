package dev.ignit.domain.model

import kotlin.test.Test
import kotlin.test.assertEquals

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
}
