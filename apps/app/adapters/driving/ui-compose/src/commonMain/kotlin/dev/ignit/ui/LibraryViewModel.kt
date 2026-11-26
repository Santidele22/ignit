// Driving adapter: Compose UI. Calls use cases only — never Ktor/DB directly.
package dev.ignit.ui

import androidx.compose.runtime.*
import dev.ignit.application.usecase.SyncLibrary
import dev.ignit.domain.model.Book

class LibraryViewModel(private val syncLibrary: SyncLibrary) {
	var books by mutableStateOf<List<Book>>(emptyList())
		private set
	var loading by mutableStateOf(false)
		private set

	suspend fun load() {
		loading = true
		books = syncLibrary().getOrDefault(emptyList())
		loading = false
	}
}

@Composable
fun LibraryScreen(viewModel: LibraryViewModel) {
	val items = viewModel.books
	if (viewModel.loading) {
		androidx.compose.material3.CircularProgressIndicator()
	} else {
		androidx.compose.foundation.layout.Column {
			items.forEach { book ->
				androidx.compose.material3.Text(book.title)
			}
		}
	}
}
