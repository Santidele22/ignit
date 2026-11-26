// adapters/driving/ui-compose: driving adapter. Root navigation Login => Biblioteca over use cases only.
package dev.ignit.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.ignit.application.usecase.GetCurrentSession
import dev.ignit.application.usecase.LogOut
import dev.ignit.application.usecase.PalettePreference
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
	getCurrentSession: GetCurrentSession,
	logOut: LogOut,
	palettePreference: PalettePreference,
) {
	val scope = rememberCoroutineScope()
	var session by remember { mutableStateOf<UserSession?>(null) }
	var restoring by remember { mutableStateOf(true) }
	var palette by remember { mutableStateOf(IgnitPalette.ORIGINAL) }

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
						if (current == null) {
							LoginScreen(
								viewModel = loginViewModel,
								onLoggedIn = { loggedIn -> session = loggedIn },
							)
						} else {
							LibraryPlaceholder(
								session = current,
								onLogOut = {
									scope.launch {
										logOut()
										session = null
										loginViewModel.clearSession()
									}
								},
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
	Row(
		modifier = modifier
			.clip(MaterialTheme.shapes.small)
			.background(MaterialTheme.colorScheme.surfaceContainerLow)
			.border(1.dp, MaterialTheme.colorScheme.outline, MaterialTheme.shapes.small)
			.testTag("palette-toggle"),
	) {
		PaletteOption(
			label = "ORIGINAL",
			selected = palette == IgnitPalette.ORIGINAL,
			testTag = "palette-original",
			onSelect = { onSelect(IgnitPalette.ORIGINAL) },
		)
		PaletteOption(
			label = "NOCHE AZUL",
			selected = palette == IgnitPalette.NOCHE_AZUL,
			testTag = "palette-noche-azul",
			onSelect = { onSelect(IgnitPalette.NOCHE_AZUL) },
		)
	}
}

/** One option of [PaletteToggle]; the selected one sits on the brand accent like the web's `aria-pressed`. */
@Composable
private fun PaletteOption(
	label: String,
	selected: Boolean,
	testTag: String,
	onSelect: () -> Unit,
) {
	Row(
		modifier = Modifier
			.background(if (selected) MaterialTheme.colorScheme.tertiaryContainer else Color.Transparent)
			.clickable(onClick = onSelect)
			.padding(horizontal = 10.dp, vertical = 6.dp)
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

/** Phase-1 stand-in for the library: who is signed in, how to sign out, and what comes next. */
@Composable
private fun LibraryPlaceholder(session: UserSession, onLogOut: () -> Unit) {
	Column(
		modifier = Modifier.fillMaxSize().padding(24.dp),
		verticalArrangement = Arrangement.spacedBy(8.dp),
	) {
		Text(
			text = "Biblioteca",
			style = MaterialTheme.typography.headlineMedium,
		)
		Text(
			text = session.name,
			style = MaterialTheme.typography.titleMedium,
		)
		Text(
			text = session.email,
			style = MaterialTheme.typography.bodyMedium,
			color = MaterialTheme.colorScheme.onSurfaceVariant,
		)
		Spacer(Modifier.height(8.dp))
		Text(
			text = "Tu biblioteca llega en la próxima fase: por ahora la sesión ya quedó guardada.",
			style = MaterialTheme.typography.bodyMedium,
			color = MaterialTheme.colorScheme.onSurfaceVariant,
		)
		Spacer(Modifier.height(16.dp))
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
