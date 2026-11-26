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
import dev.ignit.application.usecase.SyncLibrary
import dev.ignit.http.KtorAuthGateway
import dev.ignit.http.KtorLibraryRepository
import dev.ignit.http.createIgnitHttpClient
import dev.ignit.preferences.FilePreferencesStore
import dev.ignit.session.FileAuthSession
import dev.ignit.ui.IgnitApp
import dev.ignit.ui.LoginViewModel

/**
 * Composition root of the desktop app.
 *
 * `IgnitApiConfig` is generated from the `ignit.environment` Gradle property, so the same code builds
 * against production (the default) or a local backend (`-Pignit.environment=local`). The profile carries
 * the base URL and both API paths, because the two environments differ in the auth endpoint and in the
 * REST prefix, not just the host.
 */
fun main() = application {
	val httpClient = remember { createIgnitHttpClient() }
	val authSession = remember { FileAuthSession() }
	val preferences = remember { FilePreferencesStore() }
	val authGateway = remember {
		KtorAuthGateway(httpClient, IgnitApiConfig.API_BASE_URL, IgnitApiConfig.SIGN_IN_PATH)
	}
	val palettePreference = remember { PalettePreference(preferences) }
	// The library adapter reads the session itself: the catalog needs the signed cookie.
	val syncLibrary = remember {
		SyncLibrary(
			KtorLibraryRepository(
				httpClient,
				IgnitApiConfig.API_BASE_URL,
				authSession,
				IgnitApiConfig.BOOKS_PATH,
			),
		)
	}

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
			syncLibrary = syncLibrary,
			getCurrentSession = GetCurrentSession(authSession),
			logOut = LogOut(authSession),
			palettePreference = palettePreference,
		)
	}
}
