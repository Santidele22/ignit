// platforms/android: entry point. Composition root: adapters in, use cases out, UI on top.
package dev.ignit.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.remember
import dev.ignit.application.usecase.GetCurrentSession
import dev.ignit.application.usecase.LogIn
import dev.ignit.application.usecase.LogOut
import dev.ignit.application.usecase.PalettePreference
import dev.ignit.application.usecase.SyncLibrary
import dev.ignit.http.KtorAuthGateway
import dev.ignit.http.KtorLibraryRepository
import dev.ignit.http.createIgnitHttpClient
import dev.ignit.preferences.SharedPreferencesStore
import dev.ignit.session.KeystoreAuthSession
import dev.ignit.ui.IgnitApp
import dev.ignit.ui.LoginViewModel
import io.ktor.client.HttpClient

/**
 * Composition root of the Android app.
 *
 * `IgnitApiConfig.API_BASE_URL` is generated from the `ignit.apiBaseUrl` Gradle property, so the same
 * code builds against production (the default) or a local backend (`-Pignit.apiBaseUrl=http://10.0.2.2:3000`).
 */
class MainActivity : ComponentActivity() {
	private val httpClient: HttpClient by lazy { createIgnitHttpClient() }

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)

		// Driven adapters: the Keystore session store, the plain preferences store, and the HTTP gateway.
		val authSession = KeystoreAuthSession(applicationContext)
		val preferences = SharedPreferencesStore(applicationContext)
		val authGateway = KtorAuthGateway(httpClient, IgnitApiConfig.API_BASE_URL)
		val palettePreference = PalettePreference(preferences)
		// The library adapter reads the session itself: the catalog needs the signed cookie.
		val syncLibrary = SyncLibrary(KtorLibraryRepository(httpClient, IgnitApiConfig.API_BASE_URL, authSession))

		// Driving side gets use cases only — it never sees Ktor or the Keystore. `IgnitApp` owns the
		// theme and its surface so the palette can change at runtime.
		setContent {
			val loginViewModel = remember { LoginViewModel(LogIn(authGateway, authSession)) }

			IgnitApp(
				loginViewModel = loginViewModel,
				syncLibrary = syncLibrary,
				getCurrentSession = GetCurrentSession(authSession),
				logOut = LogOut(authSession),
				palettePreference = palettePreference,
			)
		}
	}

	override fun onDestroy() {
		httpClient.close()
		super.onDestroy()
	}
}
