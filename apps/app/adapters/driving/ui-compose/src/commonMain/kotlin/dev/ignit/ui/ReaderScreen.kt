package dev.ignit.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ignit.domain.model.Book
import dev.ignit.domain.model.DomainReadingChunk
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

@Composable
fun ReaderScreen(
	book: Book,
	viewModel: ReaderViewModel,
	onBack: () -> Unit,
) {
	val scope = rememberCoroutineScope()
	var showInfo by remember { mutableStateOf(false) }

	LaunchedEffect(book.id) {
		viewModel.open(book)
	}

	val bgColor = if (viewModel.vigiliaMode) Color(0xFF04050A) else Color(0xFFF6F1E7)
	val textColor = if (viewModel.vigiliaMode) Color(0xFFE7E2D8) else Color(0xFF1D1A16)
	val mutedColor = if (viewModel.vigiliaMode) Color(0xFF8C92A4) else Color(0xFF6B655D)

	Column(
		modifier = Modifier
			.fillMaxSize()
			.background(bgColor)
			.padding(top = 48.dp, start = 16.dp, end = 16.dp, bottom = 16.dp),
	) {
		Row(
			modifier = Modifier.fillMaxWidth(),
			verticalAlignment = Alignment.CenterVertically,
			horizontalArrangement = Arrangement.SpaceBetween,
		) {
			TextButton(onClick = onBack) {
				Text("← Biblioteca", color = textColor)
			}
			Column(modifier = Modifier.weight(1f).padding(horizontal = 8.dp)) {
				Text(
					text = book.title,
					color = textColor,
					style = MaterialTheme.typography.titleSmall,
					maxLines = 1,
					overflow = TextOverflow.Ellipsis,
				)
				if (book.author.isNotBlank()) {
					Text(
						text = book.author,
						color = mutedColor,
						style = MaterialTheme.typography.bodySmall,
						maxLines = 1,
						overflow = TextOverflow.Ellipsis,
					)
				}
			}
			Row {
				TextButton(onClick = { showInfo = !showInfo }) {
					Text("Ficha", color = mutedColor)
				}
				TextButton(onClick = { viewModel.toggleVigiliaMode() }) {
					Text(if (viewModel.vigiliaMode) "Día" else "Vigilia", color = textColor)
				}
			}
		}

		if (showInfo) {
			Column(
				modifier = Modifier
					.fillMaxWidth()
					.padding(vertical = 8.dp)
					.background(if (viewModel.vigiliaMode) Color(0xFF10131C) else Color(0xFFECE5D8))
					.padding(12.dp),
			) {
				Text(book.title, color = textColor, fontWeight = FontWeight.SemiBold)
				if (book.author.isNotBlank()) Text("Autor: ${book.author}", color = mutedColor)
				if (book.kind.isNotBlank()) Text("Estante: ${book.kind}", color = mutedColor)
				Text("Páginas: ${book.totalPages}", color = mutedColor)
			}
		}

		Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
			when {
				viewModel.loading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
				viewModel.error != null -> Column(
					modifier = Modifier.align(Alignment.Center),
					horizontalAlignment = Alignment.CenterHorizontally,
				) {
					Text(viewModel.error!!, color = MaterialTheme.colorScheme.error)
					Spacer(Modifier.height(12.dp))
					OutlinedButton(onClick = { scope.launch { viewModel.open(book) } }) {
						Text("Reintentar", color = textColor)
					}
				}
				viewModel.pages.isEmpty() -> Text(
					"Este libro no tiene páginas legibles todavía.",
					color = mutedColor,
					modifier = Modifier.align(Alignment.Center),
				)
				else -> {
					val pagerState = rememberPagerState(
						initialPage = (viewModel.currentPage - 1).coerceIn(0, viewModel.pages.lastIndex),
						pageCount = { viewModel.pages.size },
					)

					LaunchedEffect(pagerState) {
						snapshotFlow { pagerState.currentPage + 1 }
							.distinctUntilChanged()
							.collect { pageNum ->
								viewModel.onPageChanged(pageNum)
							}
					}

					HorizontalPager(
						state = pagerState,
						modifier = Modifier.fillMaxSize(),
					) { pageIndex ->
						val pageChunks = viewModel.pages[pageIndex]
						Column(
							modifier = Modifier
								.fillMaxSize()
								.verticalScroll(rememberScrollState())
								.padding(vertical = 12.dp, horizontal = 6.dp),
							verticalArrangement = Arrangement.spacedBy(12.dp),
						) {
							for (chunk in pageChunks) {
								ReaderChunkBlock(chunk, textColor, mutedColor)
							}
						}
					}
				}
			}
		}

		val total = viewModel.pages.size.coerceAtLeast(1)
		val pct = (viewModel.currentPage.toFloat() / total.toFloat()).coerceIn(0f, 1f)
		Spacer(Modifier.height(8.dp))
		LinearProgressIndicator(
			progress = { pct },
			modifier = Modifier.fillMaxWidth(),
		)
		Spacer(Modifier.height(6.dp))
		Row(
			modifier = Modifier.fillMaxWidth(),
			horizontalArrangement = Arrangement.SpaceBetween,
		) {
			Text(
				text = "Página ${viewModel.currentPage} de $total",
				color = mutedColor,
				style = MaterialTheme.typography.bodySmall,
			)
			val syncLabel = when (viewModel.syncStatus) {
				ReaderSyncStatus.SYNCED -> "Sincronizado"
				ReaderSyncStatus.SAVED_LOCAL -> "Guardado local"
				ReaderSyncStatus.PENDING_OFFLINE -> "Pendiente offline"
				ReaderSyncStatus.IDLE -> ""
			}
			Text(syncLabel, color = mutedColor, style = MaterialTheme.typography.bodySmall)
		}
	}
}

@Composable
private fun ReaderChunkBlock(
	chunk: DomainReadingChunk,
	textColor: Color,
	mutedColor: Color,
) {
	when (chunk.type) {
		"heading" -> Text(
			text = chunk.text,
			color = textColor,
			fontSize = if ((chunk.level ?: 1) == 1) 22.sp else 18.sp,
			fontWeight = FontWeight.Bold,
			lineHeight = 28.sp,
		)
		"dialogue" -> Row(modifier = Modifier.fillMaxWidth()) {
			Box(
				modifier = Modifier
					.width(3.dp)
					.height(24.dp)
					.background(Color(0xFFC86D44)),
			)
			Spacer(Modifier.width(10.dp))
			Text(
				text = chunk.text,
				color = textColor,
				fontSize = 17.sp,
				lineHeight = 27.sp,
			)
		}
		"quote" -> Text(
			text = chunk.text,
			color = mutedColor,
			fontSize = 16.sp,
			fontStyle = FontStyle.Italic,
			lineHeight = 25.sp,
			modifier = Modifier.padding(start = 12.dp),
		)
		else -> Text(
			text = chunk.text,
			color = textColor,
			fontSize = 17.sp,
			lineHeight = 28.sp,
		)
	}
}
