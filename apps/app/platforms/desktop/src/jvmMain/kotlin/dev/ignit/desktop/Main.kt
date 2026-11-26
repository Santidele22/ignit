// Entry point Desktop: wiring only.
package dev.ignit.desktop

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import androidx.compose.foundation.layout.Box

fun main() = application {
	Window(onCloseRequest = ::exitApplication, title = "Ignit", state = rememberWindowState(width = 800.dp, height = 600.dp)) {
		MaterialTheme {
			Surface(modifier = Modifier.fillMaxSize()) {
				Box(contentAlignment = Alignment.Center) { Text("Ignit") }
			}
		}
	}
}
