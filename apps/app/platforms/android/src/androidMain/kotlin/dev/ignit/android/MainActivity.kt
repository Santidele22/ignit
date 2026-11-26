// platforms/android: entry point. Composition root: adapters in, use cases out, UI on top.
package dev.ignit.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.remember
import dev.ignit.application.usecase.GetCurrentSession
import dev.ignit.application.usecase.LogIn
import dev.ignit.application.usecase.LogOut
import dev.ignit.http.KtorAuthGateway
import dev.ignit.http.createIgnitHttpClient
import dev.ignit.session.KeystoreAuthSession
import dev.ignit.ui.IgnitApp
import dev.ignit.ui.LoginViewModel
import io.ktor.client.HttpClient

/** Production backend the native app signs in against, the same one the web app uses. */
private const val BASE_URL = "https://ignit.ignit677.workers.dev"

class MainActivity : ComponentActivity() {
	private val httpClient: HttpClient by lazy { createIgnitHttpClient() }

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)

		// Driven adapters: the Keystore session store and the HTTP auth gateway.
		val authSession = KeystoreAuthSession(applicationContext)
		val authGateway = KtorAuthGateway(httpClient, BASE_URL)

		// Driving side gets use cases only — it never sees Ktor or the Keystore. `IgnitApp` owns the
		// theme and its surface so the palette can change at runtime.
		setContent {
			val loginViewModel = remember { LoginViewModel(LogIn(authGateway, authSession)) }

			IgnitApp(
				loginViewModel = loginViewModel,
				getCurrentSession = GetCurrentSession(authSession),
				logOut = LogOut(authSession),
			)
		}
	}

	override fun onDestroy() {
		httpClient.close()
		super.onDestroy()
	}
}
