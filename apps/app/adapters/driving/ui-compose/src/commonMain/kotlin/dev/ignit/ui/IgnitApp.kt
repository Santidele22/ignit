// adapters/driving/ui-compose: driving adapter. Root navigation Login => Biblioteca over use cases only.
package dev.ignit.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.ignit.application.usecase.GetCurrentSession
import dev.ignit.application.usecase.LogOut
import dev.ignit.application.usecase.OpenBookReading
import dev.ignit.application.usecase.PalettePreference
import dev.ignit.application.usecase.SaveReadingProgress
import dev.ignit.application.usecase.SyncLibrary
import dev.ignit.application.usecase.SyncReadingProgress
import dev.ignit.domain.model.Book
import dev.ignit.domain.model.UserSession
import dev.ignit.ui.theme.IgnitPalette
import dev.ignit.ui.theme.IgnitTheme
import kotlinx.coroutines.launch

/**
 * Root of the app: a held [UserSession] shows the library, its absence shows the login screen.
 *
 * The persisted session is restored once on first composition, so a returning user lands directly
 * on the library instead of seeing the form flash by. The theme lives here too, because the palette
 * toggle above the content changes it at runtime; the platform roots only host this composable.
 * The palette itself is restored from [palettePreference] during that same first composition and
 * saved on every toggle: the state changes immediately, the write happens in the background.
 */
@Composable
fun IgnitApp(
	loginViewModel: LoginViewModel,
	syncLibrary: SyncLibrary,
	getCurrentSession: GetCurrentSession,
	logOut: LogOut,
	palettePreference: PalettePreference,
	openBookReading: OpenBookReading? = null,
	saveReadingProgress: SaveReadingProgress? = null,
	syncReadingProgress: SyncReadingProgress? = null,
) {
	val scope = rememberCoroutineScope()
	var session by remember { mutableStateOf<UserSession?>(null) }
	var restoring by remember { mutableStateOf(true) }
	var palette by remember { mutableStateOf(IgnitPalette.ORIGINAL) }
	var activeBook by remember { mutableStateOf<Book?>(null) }
	// Covers are remote images: install the shared loader before any card can ask for one.
	IgnitImageLoader()

	LaunchedEffect(Unit) {
		session = getCurrentSession()
		val storedPalette = palettePreference.load()
		if (storedPalette != null) palette = IgnitPalette.fromName(storedPalette)
		restoring = false
	}

	IgnitTheme(palette = palette) {
		Surface(modifier = Modifier.fillMaxSize()) {
			Box(modifier = Modifier.fillMaxSize()) {
				when {
					restoring -> Box(
						modifier = Modifier.fillMaxSize(),
						contentAlignment = Alignment.Center,
					) {
						CircularProgressIndicator()
					}

					else -> {
						val current = session
						val readingBook = activeBook
						if (current == null) {
							LoginScreen(
								viewModel = loginViewModel,
								onLoggedIn = { loggedIn -> session = loggedIn },
							)
						} else if (readingBook != null && openBookReading != null && saveReadingProgress != null && syncReadingProgress != null) {
							ReaderScreen(
								book = readingBook,
								viewModel = remember(readingBook.id) {
									ReaderViewModel(openBookReading, saveReadingProgress, syncReadingProgress)
								},
								onBack = { activeBook = null },
							)
						} else {
							LibraryScreen(
								viewModel = remember { LibraryViewModel(syncLibrary) },
								session = current,
								onLogOut = {
									scope.launch {
										logOut()
										activeBook = null
										session = null
										loginViewModel.clearSession()
									}
								},
								onOpenBook = { book -> activeBook = book },
							)
						}
					}
				}

				PaletteToggle(
					palette = palette,
					onSelect = { selected ->
						// Apply first so the UI never lags behind the tap, then persist off the main path.
						palette = selected
						scope.launch { palettePreference.save(selected.persistedName) }
					},
					modifier = Modifier.align(Alignment.TopEnd).padding(16.dp),
				)
			}
		}
	}
}

/**
 * Palette selector, mirroring the web's `PaletteToggle.astro`: a hairline frame on a card track with
 * two wide-tracked uppercase options, the active one filled with the brand accent.
 */
@Composable
private fun PaletteToggle(
	palette: IgnitPalette,
	onSelect: (IgnitPalette) -> Unit,
	modifier: Modifier = Modifier,
) {
	SegmentedToggle(modifier = modifier, tag = "palette-toggle") {
		SegmentedToggleOption(
			label = "ORIGINAL",
			selected = palette == IgnitPalette.ORIGINAL,
			testTag = "palette-original",
			onSelect = { onSelect(IgnitPalette.ORIGINAL) },
		)
		SegmentedToggleOption(
			label = "NOCHE AZUL",
			selected = palette == IgnitPalette.NOCHE_AZUL,
			testTag = "palette-noche-azul",
			onSelect = { onSelect(IgnitPalette.NOCHE_AZUL) },
		)
	}
}
