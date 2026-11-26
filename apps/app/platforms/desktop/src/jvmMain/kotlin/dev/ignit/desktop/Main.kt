// platforms/desktop: entry point. Composition root mirroring MainActivity over the JVM file store.
package dev.ignit.desktop

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import dev.ignit.application.usecase.GetCurrentSession
import dev.ignit.application.usecase.LogIn
import dev.ignit.application.usecase.LogOut
import dev.ignit.http.KtorAuthGateway
import dev.ignit.http.createIgnitHttpClient
import dev.ignit.session.FileAuthSession
import dev.ignit.ui.IgnitApp
import dev.ignit.ui.LoginViewModel
import dev.ignit.ui.theme.IgnitTheme

/** Production backend the native app signs in against, the same one the web app uses. */
private const val BASE_URL = "https://ignit.ignit677.workers.dev"

fun main() = application {
	val httpClient = remember { createIgnitHttpClient() }
	val authSession = remember { FileAuthSession() }
	val authGateway = remember { KtorAuthGateway(httpClient, BASE_URL) }

	DisposableEffect(Unit) {
		onDispose { httpClient.close() }
	}

	Window(
		onCloseRequest = ::exitApplication,
		title = "Ignit",
		state = rememberWindowState(width = 420.dp, height = 780.dp),
	) {
		val loginViewModel = remember { LoginViewModel(LogIn(authGateway, authSession)) }

		IgnitTheme {
			Surface(modifier = Modifier.fillMaxSize()) {
				IgnitApp(
					loginViewModel = loginViewModel,
					getCurrentSession = GetCurrentSession(authSession),
					logOut = LogOut(authSession),
				)
			}
		}
	}
}
