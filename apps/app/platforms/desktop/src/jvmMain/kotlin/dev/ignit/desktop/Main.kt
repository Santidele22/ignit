// platforms/desktop: entry point. Composition root mirroring MainActivity over the JVM file store.
package dev.ignit.desktop

import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import dev.ignit.application.usecase.GetCurrentSession
import dev.ignit.application.usecase.LogIn
import dev.ignit.application.usecase.LogOut
import dev.ignit.application.usecase.PalettePreference
import dev.ignit.http.KtorAuthGateway
import dev.ignit.http.createIgnitHttpClient
import dev.ignit.preferences.FilePreferencesStore
import dev.ignit.session.FileAuthSession
import dev.ignit.ui.IgnitApp
import dev.ignit.ui.LoginViewModel

/** Production backend the native app signs in against, the same one the web app uses. */
private const val BASE_URL = "https://ignit.ignit677.workers.dev"

fun main() = application {
	val httpClient = remember { createIgnitHttpClient() }
	val authSession = remember { FileAuthSession() }
	val preferences = remember { FilePreferencesStore() }
	val authGateway = remember { KtorAuthGateway(httpClient, BASE_URL) }
	val palettePreference = remember { PalettePreference(preferences) }

	DisposableEffect(Unit) {
		onDispose { httpClient.close() }
	}

	Window(
		onCloseRequest = ::exitApplication,
		title = "Ignit",
		state = rememberWindowState(width = 420.dp, height = 780.dp),
	) {
		val loginViewModel = remember { LoginViewModel(LogIn(authGateway, authSession)) }

		// `IgnitApp` owns the theme and its surface so the palette can change at runtime.
		IgnitApp(
			loginViewModel = loginViewModel,
			getCurrentSession = GetCurrentSession(authSession),
			logOut = LogOut(authSession),
			palettePreference = palettePreference,
		)
	}
}
