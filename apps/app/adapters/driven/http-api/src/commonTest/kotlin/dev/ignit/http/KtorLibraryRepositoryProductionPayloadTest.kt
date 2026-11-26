// adapters/driven/http-api: test. Pins the parser against a real production payload, not a sketch.
package dev.ignit.http

import dev.ignit.application.port.AuthSession
import dev.ignit.domain.model.UserSession
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private const val BASE_URL = "https://ignit.ignit677.workers.dev"

/**
 * Captured from `GET {BASE_URL}/api/books` (anonymous, HTTP 200) with two entries kept verbatim
 * and the rest trimmed. It is here because the payload has traits a hand-written fixture hides:
 * a bare array, a numeric `id`, `filePages` instead of `totalPages`, a nullable `coverUrl` on the
 * second book, and many fields the app deliberately ignores.
 */
private const val PRODUCTION_PAYLOAD = """
[
  {
    "id": 8,
    "title": "La máquina se detiene",
    "author": "E. M. Forster",
    "description": "Relato distópico de ciencia ficción.",
    "status": "queued",
    "kind": "terror_scifi",
    "review": null,
    "published": true,
    "filePath": "1795565116992-4c529e962020.pdf",
    "originalName": "la-maquina-se-detiene-por-e.m.-forster-1909.pdf",
    "filePages": 18,
    "fileSize": "151009",
    "fileHash": "40272397009de97838b9a55145f55bd9ff7ef0ca3ecda7f6220d48fd5e24a4df",
    "mimeType": "application/pdf",
    "coverUrl": "https://is1-ssl.mzstatic.com/image/thumb/Publication/eb/ee/7b/mzi.muoxymhd.jpg/600x600bb.jpg",
    "publisher": null,
    "translator": null,
    "illustrator": null,
    "isbn": null,
    "license": "Dominio público",
    "ctaLabel": null,
    "ctaUrl": null,
    "createdAt": "2026-11-25T00:05:13.615Z",
    "isOwner": false
  },
  {
    "id": 9,
    "title": "Pro Git (2.ª edición)",
    "author": "Scott Chacon & Ben Straub",
    "description": "Guía completa y oficial de Git en español.",
    "status": "ready",
    "kind": "tecnico",
    "review": null,
    "published": true,
    "filePath": "1795565116992-progit.pdf",
    "originalName": "pro-git.pdf",
    "filePages": 320,
    "fileSize": "2048000",
    "fileHash": "aa",
    "mimeType": "application/pdf",
    "coverUrl": null,
    "publisher": null,
    "translator": null,
    "illustrator": null,
    "isbn": null,
    "license": null,
    "ctaLabel": null,
    "ctaUrl": null,
    "createdAt": "2026-11-25T00:06:14.615Z",
    "isOwner": false
  }
]
"""

private class AnonymousSession : AuthSession {
	override suspend fun load(): UserSession? = null
	override suspend fun save(session: UserSession) = Unit
	override suspend fun clear() = Unit
}

class KtorLibraryRepositoryProductionPayloadTest {
	private fun repository(): KtorLibraryRepository = KtorLibraryRepository(
		HttpClient(MockEngine {
			respond(
				content = PRODUCTION_PAYLOAD,
				status = HttpStatusCode.OK,
				headers = headersOf(HttpHeaders.ContentType, "application/json"),
			)
		}) { expectSuccess = false },
		BASE_URL,
		AnonymousSession(),
	)

	@Test
	fun anonymousCatalogParsesTheRealPayload() = runTest {
		val books = repository().fetchLibrary()

		assertEquals(2, books.size)
		val first = books.first()
		assertEquals("8", first.id)
		assertEquals("La máquina se detiene", first.title)
		assertEquals("E. M. Forster", first.author)
		assertEquals("terror_scifi", first.kind)
		assertEquals(18, first.totalPages)
		assertEquals(true, first.published)
		assertEquals(
			"https://is1-ssl.mzstatic.com/image/thumb/Publication/eb/ee/7b/mzi.muoxymhd.jpg/600x600bb.jpg",
			first.coverUrl,
		)
	}

	@Test
	fun aBookWithoutCoverAndWithANumericIdStaysUsable() = runTest {
		val second = repository().fetchLibrary()[1]

		assertEquals("9", second.id)
		assertEquals("tecnico", second.kind)
		assertEquals(320, second.totalPages)
		assertNull(second.coverUrl)
	}
}
