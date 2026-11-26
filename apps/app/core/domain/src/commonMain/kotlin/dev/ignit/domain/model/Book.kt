// core/domain: entities and rules. Pure Kotlin — no framework imports reach this source set.
package dev.ignit.domain.model

data class Book(
	val id: String,
	val title: String,
	val roomId: String,
	val totalPages: Int,
)
