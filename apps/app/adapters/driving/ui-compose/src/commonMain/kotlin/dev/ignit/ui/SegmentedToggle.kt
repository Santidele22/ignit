// adapters/driving/ui-compose: component. Hairline segmented control shared by the palette picker and the library filters.
package dev.ignit.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Hairline segmented control, mirroring the web's `PaletteToggle.astro`: a frame on a card track
 * holding wide-tracked uppercase options, the active one filled with the brand accent.
 *
 * Shared by the palette picker and the library scope selector so both speak the same visual
 * language instead of drifting apart.
 */
@Composable
fun SegmentedToggle(
	modifier: Modifier = Modifier,
	tag: String,
	options: @Composable RowScope.() -> Unit,
) {
	Row(
		modifier = modifier
			.clip(MaterialTheme.shapes.small)
			.background(MaterialTheme.colorScheme.surfaceContainerLow)
			.border(1.dp, MaterialTheme.colorScheme.outline, MaterialTheme.shapes.small)
			.testTag(tag),
		content = options,
	)
}

/** One option of [SegmentedToggle]; the selected one sits on the brand accent like the web's `aria-pressed`. */
@Composable
fun RowScope.SegmentedToggleOption(
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
