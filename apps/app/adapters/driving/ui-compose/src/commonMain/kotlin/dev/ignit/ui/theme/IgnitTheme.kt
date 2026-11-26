// adapters/driving/ui-compose: theme. Values are transcribed from design/system.md (web tokens).
package dev.ignit.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The two palettes the web lets the user pick between (`PaletteToggle.astro`).
 *
 * [ORIGINAL] is the warm paper palette and follows the system light/dark setting. [NOCHE_AZUL] is
 * the blue-black monochrome palette: it forces dark, so it never follows OS light mode and never
 * inherits the warm paper tokens.
 */
enum class IgnitPalette { ORIGINAL, NOCHE_AZUL }

/**
 * Ignit palette, transcribed from `design/system.md` (synced from
 * `web/src/app/styles/global.css`). Warm paper, ink, and the brand red of the hanko seal.
 *
 * All themes are declared here rather than relying on Material's baseline, which ships the
 * default purple and is the reason the app looked unrelated to the web.
 */
private object Light {
	val background = Color(0xFFF4EFE4)
	val foreground = Color(0xFF23201A)
	val card = Color(0xFFFBF8F0)
	val primary = Color(0xFF23201A)
	val primaryForeground = Color(0xFFF4EFE4)
	val secondary = Color(0xFFECE5D4)
	val secondaryForeground = Color(0xFF23201A)
	val muted = Color(0xFFEBE4D2)
	val mutedForeground = Color(0xFF6F6657)
	val accent = Color(0xFFE9E1CD)
	val accentForeground = Color(0xFF23201A)
	val destructive = Color(0xFFA6362F)
	val border = Color(0xFFDDD2BC)
	val input = Color(0xFFDDD2BC)
	val ring = Color(0xFFC73E3A)
	val aka = Color(0xFFC73E3A)
	val akaDeep = Color(0xFFA02F2B)
	val akaForeground = Color(0xFFFDF8EE)
	val inkSoft = Color(0xFF57503F)
}

private object NocheAzul {
	val background = Color(0xFF04050A)
	val foreground = Color(0xFFE6EDF7)
	val card = Color(0xFF060810)
	val primary = Color(0xFFE6EDF7)
	val primaryForeground = Color(0xFF04050A)
	val secondary = Color(0xFF080C17)
	val secondaryForeground = Color(0xFFE6EDF7)
	val muted = Color(0xFF0B1020)
	val mutedForeground = Color(0xFF8296B8)
	val accent = Color(0xFF10172B)
	val accentForeground = Color(0xFFE6EDF7)
	val destructive = Color(0xFFD96B73)
	val border = Color(0xFF232941)
	val input = Color(0xFF344064)
	val ring = Color(0xFF9FC0EE)
	val aka = Color(0xFF5F86C9)
	val akaDeep = Color(0xFF43649E)
	val akaForeground = Color(0xFF04050A)
	val inkSoft = Color(0xFFB9C6DD)
}

private object Dark {
	val background = Color(0xFF14110D)
	val foreground = Color(0xFFEAE3D3)
	val card = Color(0xFF1C1812)
	val primary = Color(0xFFEAE3D3)
	val primaryForeground = Color(0xFF14110D)
	val secondary = Color(0xFF241F17)
	val secondaryForeground = Color(0xFFEAE3D3)
	val muted = Color(0xFF231E16)
	val mutedForeground = Color(0xFFA29681)
	val accent = Color(0xFF2A241A)
	val accentForeground = Color(0xFFEAE3D3)
	val destructive = Color(0xFFD95448)
	val border = Color(0xFF322B20)
	val input = Color(0xFF322B20)
	val ring = Color(0xFFD95448)
	val aka = Color(0xFFD95448)
	val akaDeep = Color(0xFFC73E3A)
	val akaForeground = Color(0xFFFDF8EE)
	val inkSoft = Color(0xFFA29681)
}

/** Brand red of the hanko seal: focus rings, selection, and the one accent that is allowed to pop. */
val IgnitBrandRed: Color = Light.aka

private val IgnitLightScheme: ColorScheme = lightColorScheme(
	primary = Light.primary,
	onPrimary = Light.primaryForeground,
	primaryContainer = Light.secondary,
	onPrimaryContainer = Light.primaryForeground,
	secondary = Light.secondary,
	onSecondary = Light.secondaryForeground,
	secondaryContainer = Light.accent,
	onSecondaryContainer = Light.accentForeground,
	// `tertiary` carries `--ring`, not `--aka`: the login fields use it for the focus colour, and in
	// `noche-azul` the focus ring and the brand accent are different values.
	tertiary = Light.ring,
	onTertiary = Light.background,
	tertiaryContainer = Light.aka,
	onTertiaryContainer = Light.akaForeground,
	background = Light.background,
	onBackground = Light.foreground,
	surface = Light.background,
	onSurface = Light.foreground,
	surfaceVariant = Light.secondary,
	onSurfaceVariant = Light.inkSoft,
	surfaceTint = Light.aka,
	surfaceContainerLowest = Light.card,
	surfaceContainerLow = Light.card,
	surfaceContainer = Light.background,
	surfaceContainerHigh = Light.secondary,
	surfaceContainerHighest = Light.muted,
	inverseSurface = Light.foreground,
	inverseOnSurface = Light.background,
	error = Light.destructive,
	onError = Light.akaForeground,
	errorContainer = Light.accent,
	onErrorContainer = Light.destructive,
	outline = Light.border,
	outlineVariant = Light.input,
	scrim = Light.foreground,
)

private val IgnitDarkScheme: ColorScheme = darkColorScheme(
	primary = Dark.primary,
	onPrimary = Dark.primaryForeground,
	primaryContainer = Dark.secondary,
	onPrimaryContainer = Dark.foreground,
	secondary = Dark.secondary,
	onSecondary = Dark.secondaryForeground,
	secondaryContainer = Dark.accent,
	onSecondaryContainer = Dark.accentForeground,
	tertiary = Dark.ring,
	onTertiary = Dark.background,
	tertiaryContainer = Dark.aka,
	onTertiaryContainer = Dark.akaForeground,
	background = Dark.background,
	onBackground = Dark.foreground,
	surface = Dark.background,
	onSurface = Dark.foreground,
	surfaceVariant = Dark.secondary,
	onSurfaceVariant = Dark.inkSoft,
	surfaceTint = Dark.aka,
	surfaceContainerLowest = Dark.background,
	surfaceContainerLow = Dark.card,
	surfaceContainer = Dark.card,
	surfaceContainerHigh = Dark.secondary,
	surfaceContainerHighest = Dark.muted,
	inverseSurface = Dark.foreground,
	inverseOnSurface = Dark.background,
	error = Dark.destructive,
	onError = Dark.akaForeground,
	errorContainer = Dark.accent,
	onErrorContainer = Dark.destructive,
	outline = Dark.border,
	outlineVariant = Dark.input,
	scrim = Dark.background,
)

/**
 * `noche-azul`: the second selectable palette, always dark blue monochrome (`design/system.md`).
 * Surfaces follow the artboard (`--negro`/`--panel`/`--panel-2`); `tertiary` is `--ring` so the login
 * fields focus in `#9FC0EE`, while the brand blue `--aka` stays available as `tertiaryContainer`.
 */
private val IgnitNocheAzulScheme: ColorScheme = darkColorScheme(
	primary = NocheAzul.primary,
	onPrimary = NocheAzul.primaryForeground,
	primaryContainer = NocheAzul.secondary,
	onPrimaryContainer = NocheAzul.foreground,
	secondary = NocheAzul.secondary,
	onSecondary = NocheAzul.secondaryForeground,
	secondaryContainer = NocheAzul.accent,
	onSecondaryContainer = NocheAzul.accentForeground,
	tertiary = NocheAzul.ring,
	onTertiary = NocheAzul.background,
	tertiaryContainer = NocheAzul.aka,
	onTertiaryContainer = NocheAzul.akaForeground,
	background = NocheAzul.background,
	onBackground = NocheAzul.foreground,
	surface = NocheAzul.background,
	onSurface = NocheAzul.foreground,
	surfaceVariant = NocheAzul.secondary,
	onSurfaceVariant = NocheAzul.inkSoft,
	surfaceTint = NocheAzul.aka,
	surfaceContainerLowest = NocheAzul.card,
	surfaceContainerLow = NocheAzul.card,
	surfaceContainer = NocheAzul.secondary,
	surfaceContainerHigh = NocheAzul.secondary,
	surfaceContainerHighest = NocheAzul.muted,
	inverseSurface = NocheAzul.foreground,
	inverseOnSurface = NocheAzul.background,
	error = NocheAzul.destructive,
	onError = NocheAzul.akaForeground,
	errorContainer = NocheAzul.accent,
	onErrorContainer = NocheAzul.destructive,
	outline = NocheAzul.border,
	outlineVariant = NocheAzul.input,
	scrim = NocheAzul.background,
)

/**
 * Editorial type: the web pairs a Mincho serif for headings with a Zen Kaku sans for UI text.
 * Those font files are not shipped with the app, so the documented fallback stacks are used
 * (`Georgia`/serif and `system-ui`/sans), which Compose resolves per platform.
 */
private val IgnitTypography: Typography = Typography().let { baseline ->
	baseline.copy(
		displaySmall = baseline.displaySmall.copy(fontFamily = FontFamily.Serif, letterSpacing = 0.sp),
		headlineLarge = baseline.headlineLarge.copy(fontFamily = FontFamily.Serif, letterSpacing = 0.sp),
		headlineMedium = baseline.headlineMedium.copy(fontFamily = FontFamily.Serif, letterSpacing = 0.sp),
		headlineSmall = baseline.headlineSmall.copy(fontFamily = FontFamily.Serif, letterSpacing = 0.sp),
		titleLarge = baseline.titleLarge.copy(fontFamily = FontFamily.Serif),
		titleMedium = baseline.titleMedium.copy(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Medium),
		titleSmall = baseline.titleSmall.copy(fontFamily = FontFamily.SansSerif),
		bodyLarge = baseline.bodyLarge.copy(fontFamily = FontFamily.SansSerif),
		bodyMedium = baseline.bodyMedium.copy(fontFamily = FontFamily.SansSerif),
		bodySmall = baseline.bodySmall.copy(fontFamily = FontFamily.SansSerif),
		labelLarge = baseline.labelLarge.copy(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Medium),
		labelMedium = baseline.labelMedium.copy(fontFamily = FontFamily.SansSerif),
		labelSmall = baseline.labelSmall.copy(fontFamily = FontFamily.SansSerif, letterSpacing = 0.5.sp),
	)
}

/** `--radius` is `0.375rem` and scales by ±2/4px for the small and large steps. */
private val IgnitShapes: Shapes = Shapes(
	extraSmall = RoundedCornerShape(2.dp),
	small = RoundedCornerShape(4.dp),
	medium = RoundedCornerShape(6.dp),
	large = RoundedCornerShape(8.dp),
	extraLarge = RoundedCornerShape(12.dp),
)

/**
 * Root theme. [IgnitPalette.ORIGINAL] follows the system light/dark setting, because the web palette
 * declares both and the paper tokens are too bright to sit on a dark surface. [IgnitPalette.NOCHE_AZUL]
 * is always the blue scheme: the web palette forces `color-scheme: dark`, so it never follows OS
 * light mode.
 */
@Composable
fun IgnitTheme(
	palette: IgnitPalette = IgnitPalette.ORIGINAL,
	darkTheme: Boolean = isSystemInDarkTheme(),
	content: @Composable () -> Unit,
) {
	val colorScheme = when (palette) {
		IgnitPalette.ORIGINAL -> if (darkTheme) IgnitDarkScheme else IgnitLightScheme
		IgnitPalette.NOCHE_AZUL -> IgnitNocheAzulScheme
	}
	MaterialTheme(
		colorScheme = colorScheme,
		typography = IgnitTypography,
		shapes = IgnitShapes,
		content = content,
	)
}
