// Adapter (driven): implements LibraryRepository port over Ktor.
package dev.ignit.http

import dev.ignit.application.port.LibraryRepository
import dev.ignit.domain.model.Book
import io.ktor.client.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import kotlinx.serialization.json.*

class KtorLibraryRepository(private val client: HttpClient, private val baseUrl: String) : LibraryRepository {
	override suspend fun fetchLibrary(): List<Book> {
		val response = client.get("$baseUrl/api/library")
		val json = Json.parseToJsonElement(response.bodyAsText()).jsonArray
		return json.map { element ->
			val obj = element.jsonObject
			Book(
				id = obj["id"]!!.jsonPrimitive.content,
				title = obj["title"]!!.jsonPrimitive.content,
				roomId = obj["roomId"]?.jsonPrimitive?.content ?: "",
				totalPages = obj["totalPages"]?.jsonPrimitive?.int ?: 0,
			)
		}
	}
}
