// adapters/driving/ui-compose: driving adapter. Library screen: scopes, kind dropdown, paged cover grid and its states.
package dev.ignit.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import dev.ignit.domain.model.Book
import dev.ignit.domain.model.UserSession
import kotlinx.coroutines.launch

/** Covers are printed 2:3 like the web's book cards, so the grid keeps a steady rhythm. */
private const val COVER_ASPECT_RATIO: Float = 2f / 3f

/** Stable keys for the full-width rows the grid adds below the books, so paging never re-keys a card. */
private const val LOAD_MORE_KEY: String = "library-load-more-row"
private const val LOAD_MORE_ERROR_KEY: String = "library-load-more-error-row"

/**
 * The library: who is signed in, which shelf is shown, and the books themselves.
 *
 * The screen owns the coroutine scope of every request: the view model only records the selected
 * scope and kind, and this composable launches the reload right after. A newer selection therefore
 * supersedes an older in-flight answer, and only the last request paints the grid.
 */
@Composable
fun LibraryScreen(
	viewModel: LibraryViewModel,
	session: UserSession,
	onLogOut: () -> Unit,
	onOpenBook: (Book) -> Unit = {},
) {
	val scope = rememberCoroutineScope()
	var kindPanelExpanded by remember { mutableStateOf(false) }
	val gridState = rememberLazyGridState()

	LaunchedEffect(Unit) { viewModel.load() }

	Column(
		modifier = Modifier
			.fillMaxSize()
			// The palette toggle overlays the top-end corner of the app, so the header starts below it.
			.padding(start = 20.dp, end = 20.dp, top = 56.dp, bottom = 20.dp),
	) {
		LibraryHeader(
			session = session,
			onRefresh = { scope.launch { viewModel.refresh() } },
			onLogOut = onLogOut,
		)
		Spacer(Modifier.height(20.dp))

		SegmentedToggle(tag = "library-scope") {
			SegmentedToggleOption(
				label = "Catálogo",
				selected = viewModel.scope == LibraryScope.CATALOG,
				testTag = "library-scope-catalog",
				onSelect = {
					viewModel.onScopeChange(LibraryScope.CATALOG)
					scope.launch { viewModel.load() }
				},
			)
			SegmentedToggleOption(
				label = "Mi biblioteca",
				selected = viewModel.scope == LibraryScope.MINE,
				testTag = "library-scope-mine",
				onSelect = {
					viewModel.onScopeChange(LibraryScope.MINE)
					scope.launch { viewModel.load() }
				},
			)
		}
		Spacer(Modifier.height(12.dp))

		KindDropdown(
			kinds = viewModel.availableKinds,
			selected = viewModel.kind,
			expanded = kindPanelExpanded,
			onToggle = { kindPanelExpanded = !kindPanelExpanded },
			onSelect = { value ->
				kindPanelExpanded = false
				viewModel.onKindChange(value)
				scope.launch { viewModel.load() }
			},
		)
		Spacer(Modifier.height(16.dp))

		Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
			LibraryBody(
				viewModel = viewModel,
				gridState = gridState,
				onRetry = { scope.launch { viewModel.load() } },
				onLoadMore = { scope.launch { viewModel.loadMore() } },
				onOpenBook = onOpenBook,
			)
		}
	}
}

/** Title, who is signed in, and the two actions that touch the session or the network. */
@Composable
private fun LibraryHeader(session: UserSession, onRefresh: () -> Unit, onLogOut: () -> Unit) {
	Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
		Column(modifier = Modifier.weight(1f)) {
			Text(
				text = "Biblioteca",
				style = MaterialTheme.typography.headlineMedium,
				color = MaterialTheme.colorScheme.onBackground,
			)
			Text(
				text = session.name,
				style = MaterialTheme.typography.titleSmall,
				color = MaterialTheme.colorScheme.onSurface,
			)
			Text(
				text = session.email,
				style = MaterialTheme.typography.bodySmall,
				color = MaterialTheme.colorScheme.onSurfaceVariant,
			)
		}

		Column(horizontalAlignment = Alignment.End) {
			TextButton(
				onClick = onRefresh,
				modifier = Modifier.testTag("library-refresh"),
			) {
				Text("Actualizar", style = MaterialTheme.typography.labelLarge)
			}
			// Sign-out is a secondary action: a paper app does not shout on the way out.
			OutlinedButton(
				onClick = onLogOut,
				border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
				modifier = Modifier.testTag("logout-submit"),
			) {
				Text("Cerrar sesión")
			}
		}
	}
}

/**
 * Shelf filter: a collapsed control that shows the current selection and, once opened, an inline
 * panel with every shelf the complete catalog carries.
 *
 * It is deliberately not a `DropdownMenu`: an inline panel keeps the paper look and speaks the same
 * hairline visual language as [SegmentedToggle]. The panel opens even with no shelf known yet, so
 * it can never turn into an empty or broken control: "Todos" is always there.
 */
@Composable
private fun KindDropdown(
	kinds: List<String>,
	selected: String?,
	expanded: Boolean,
	onToggle: () -> Unit,
	onSelect: (String?) -> Unit,
) {
	Column(modifier = Modifier.fillMaxWidth()) {
		Row(
			modifier = Modifier
				.fillMaxWidth()
				.clip(MaterialTheme.shapes.small)
				.background(MaterialTheme.colorScheme.surfaceContainerLow)
				.border(1.dp, MaterialTheme.colorScheme.outline, MaterialTheme.shapes.small)
				.clickable(onClick = onToggle)
				.padding(horizontal = 10.dp, vertical = 8.dp)
				.testTag("library-kind-toggle"),
			verticalAlignment = Alignment.CenterVertically,
		) {
			Text(
				text = selected?.takeIf { it.isNotBlank() }?.let(LibraryViewModel::kindLabel) ?: "Todos",
				style = MaterialTheme.typography.labelSmall,
				color = MaterialTheme.colorScheme.onSurface,
				fontWeight = FontWeight.SemiBold,
				maxLines = 1,
				overflow = TextOverflow.Ellipsis,
				modifier = Modifier.weight(1f),
			)
			// A text chevron keeps the control on the palette's own type instead of a new icon set.
			Text(
				text = if (expanded) "▴" else "▾",
				style = MaterialTheme.typography.labelSmall,
				color = MaterialTheme.colorScheme.onSurfaceVariant,
			)
		}

		if (expanded) {
			Spacer(Modifier.height(8.dp))
			// The panel sits on the same framed track as the scope selector above it.
			KindPanel(kinds = kinds, selected = selected, onSelect = onSelect)
		}
	}
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun KindPanel(kinds: List<String>, selected: String?, onSelect: (String?) -> Unit) {
	FlowRow(
		modifier = Modifier
			.fillMaxWidth()
			.clip(RoundedCornerShape(4.dp))
			.background(MaterialTheme.colorScheme.surfaceContainerLow)
			.border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(4.dp))
			.padding(8.dp),
		horizontalArrangement = Arrangement.spacedBy(8.dp),
		verticalArrangement = Arrangement.spacedBy(8.dp),
	) {
		// "Todos" always leads, so an empty or failed catalog still offers one working option.
		KindOption(
			label = "Todos",
			selected = selected == null,
			// `all` keeps the tag stable for the "every shelf" option, which has no value.
			testTag = "library-kind-all",
			onSelect = { onSelect(null) },
		)
		kinds.forEach { kind ->
			KindOption(
				label = LibraryViewModel.kindLabel(kind),
				selected = selected == kind,
				testTag = "library-kind-$kind",
				onSelect = { onSelect(kind) },
			)
		}
	}
}

@Composable
private fun KindOption(label: String, selected: Boolean, testTag: String, onSelect: () -> Unit) {
	Row(
		modifier = Modifier
			.clip(CircleShape)
			.background(if (selected) MaterialTheme.colorScheme.tertiaryContainer else Color.Transparent)
			.border(
				width = 1.dp,
				color = if (selected) MaterialTheme.colorScheme.tertiaryContainer else MaterialTheme.colorScheme.outline,
				shape = CircleShape,
			)
			.clickable(onClick = onSelect)
			.padding(horizontal = 12.dp, vertical = 6.dp)
			.testTag(testTag),
		verticalAlignment = Alignment.CenterVertically,
	) {
		Text(
			text = label,
			style = MaterialTheme.typography.labelSmall,
			color = if (selected) {
				MaterialTheme.colorScheme.onTertiaryContainer
			} else {
				MaterialTheme.colorScheme.onSurfaceVariant
			},
			fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
		)
	}
}

/**
 * Body states, in the order the user needs them: a failure with nothing behind it is louder than
 * progress, progress with nothing to show yet is a spinner, and an empty answer gets calm copy
 * instead of a bare grid. A failure with rows already on screen keeps the grid and surfaces the
 * retry in its footer, so a dropped extra page never throws away what the reader was looking at.
 */
@Composable
private fun LibraryBody(
	viewModel: LibraryViewModel,
	gridState: LazyGridState,
	onRetry: () -> Unit,
	onLoadMore: () -> Unit,
	onOpenBook: (Book) -> Unit,
) {
	val books = viewModel.books
	val error = viewModel.error

	when {
		error != null && books.isEmpty() -> LibraryError(message = error, onRetry = onRetry)
		viewModel.loading && books.isEmpty() -> Box(
			modifier = Modifier.fillMaxSize(),
			contentAlignment = Alignment.Center,
		) {
			CircularProgressIndicator()
		}

		books.isEmpty() -> Box(
			modifier = Modifier.fillMaxSize(),
			contentAlignment = Alignment.Center,
		) {
			Text(
				text = "No hay libros todavía.",
				style = MaterialTheme.typography.bodyMedium,
				color = MaterialTheme.colorScheme.onSurfaceVariant,
			)
		}

		else -> BookGrid(
			viewModel = viewModel,
			gridState = gridState,
			onLoadMore = onLoadMore,
			onOpenBook = onOpenBook,
		)
	}
}

/**
 * The cover grid plus its paging footer.
 *
 * Reaching the last cell means the reader consumed everything this page holds, so the next one is
 * requested. [derivedStateOf] keeps the layout check off the frame path, and the effect is keyed by
 * the row count too: one page fans exactly one request, and a page that does not fill the screen
 * still lets the following one through.
 */
@Composable
private fun BookGrid(
	viewModel: LibraryViewModel,
	gridState: LazyGridState,
	onLoadMore: () -> Unit,
	onOpenBook: (Book) -> Unit,
) {
	val books = viewModel.books
	val error = viewModel.error

	val atLastItem by remember(gridState) {
		derivedStateOf {
			val layout = gridState.layoutInfo
			val lastVisible = layout.visibleItemsInfo.lastOrNull()?.index ?: return@derivedStateOf false
			layout.totalItemsCount > 0 && lastVisible >= layout.totalItemsCount - 1
		}
	}

	LaunchedEffect(atLastItem, books.size) {
		// Guarded against an initial load: the empty grid also reports "at the last item". A visible
		// error pauses paging so the footer's retry is what asks again, never a silent loop.
		if (atLastItem && viewModel.hasMore && viewModel.error == null &&
			!viewModel.loading && !viewModel.loadingMore
		) {
			onLoadMore()
		}
	}

	LazyVerticalGrid(
		state = gridState,
		columns = GridCells.Adaptive(minSize = 150.dp),
		modifier = Modifier.fillMaxSize(),
		horizontalArrangement = Arrangement.spacedBy(12.dp),
		verticalArrangement = Arrangement.spacedBy(16.dp),
	) {
		items(items = books, key = { it.id }) { book -> BookCard(book, onClick = { onOpenBook(book) }) }

		if (viewModel.loadingMore) {
			item(key = LOAD_MORE_KEY, span = { GridItemSpan(maxLineSpan) }) {
				Row(
					modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
					horizontalArrangement = Arrangement.Center,
				) {
					CircularProgressIndicator(modifier = Modifier.testTag("library-load-more"))
				}
			}
		}

		// Rows are already on screen, so the failed extra page becomes a footer instead of a takeover.
		// Hidden while a retry is in flight, so the spinner is the only thing the reader waits on.
		if (error != null && !viewModel.loadingMore) {
			item(key = LOAD_MORE_ERROR_KEY, span = { GridItemSpan(maxLineSpan) }) {
				Row(
					modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
					verticalAlignment = Alignment.CenterVertically,
					horizontalArrangement = Arrangement.spacedBy(12.dp),
				) {
					Text(
						text = error,
						style = MaterialTheme.typography.bodySmall,
						color = MaterialTheme.colorScheme.error,
						modifier = Modifier.weight(1f),
					)
					OutlinedButton(
						onClick = onLoadMore,
						border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
						modifier = Modifier.testTag("library-load-more-retry"),
					) {
						Text("Reintentar")
					}
				}
			}
		}
	}
}

@Composable
private fun LibraryError(message: String, onRetry: () -> Unit) {
	Column(
		modifier = Modifier.fillMaxSize(),
		verticalArrangement = Arrangement.Center,
		horizontalAlignment = Alignment.CenterHorizontally,
	) {
		Text(
			text = message,
			style = MaterialTheme.typography.bodyMedium,
			color = MaterialTheme.colorScheme.error,
		)
		Spacer(Modifier.height(12.dp))
		OutlinedButton(
			onClick = onRetry,
			border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
			modifier = Modifier.testTag("library-retry"),
		) {
			Text("Reintentar")
		}
	}
}

/** One catalog entry: the printed cover (or its typographic stand-in), title, and author. */
@Composable
private fun BookCard(book: Book, onClick: () -> Unit = {}) {
	Column(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)) {
		Box(
			modifier = Modifier
				.fillMaxWidth()
				.aspectRatio(COVER_ASPECT_RATIO)
				.clip(MaterialTheme.shapes.medium),
		) {
			// Painted first so a null, loading, or failed cover still shows a block, never a hole.
			CoverPlaceholder(title = book.title, modifier = Modifier.matchParentSize())

			val coverUrl = book.coverUrl?.takeIf { it.isNotBlank() }
			if (coverUrl != null) {
				AsyncImage(
					model = coverUrl,
					contentDescription = book.title,
					contentScale = ContentScale.Crop,
					modifier = Modifier.matchParentSize(),
				)
			}
		}
		Spacer(Modifier.height(8.dp))
		Text(
			text = book.title,
			style = MaterialTheme.typography.titleSmall,
			maxLines = 2,
			overflow = TextOverflow.Ellipsis,
			color = MaterialTheme.colorScheme.onSurface,
		)
		if (book.author.isNotBlank()) {
			Text(
				text = book.author,
				style = MaterialTheme.typography.bodySmall,
				maxLines = 1,
				overflow = TextOverflow.Ellipsis,
				color = MaterialTheme.colorScheme.onSurfaceVariant,
			)
		}
	}
}

/** Typographic stand-in: the title's initial on a quiet block, matching the paper palette. */
@Composable
private fun CoverPlaceholder(title: String, modifier: Modifier = Modifier) {
	Box(
		modifier = modifier.background(MaterialTheme.colorScheme.surfaceContainerHigh),
		contentAlignment = Alignment.Center,
	) {
		Text(
			text = title.firstOrNull()?.uppercase() ?: "·",
			style = MaterialTheme.typography.headlineMedium,
			color = MaterialTheme.colorScheme.onSurfaceVariant,
		)
	}
}
