// adapters/driving/ui-compose: driving adapter. Root navigation Login => Biblioteca over use cases only.
package dev.ignit.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import dev.ignit.application.usecase.GetCurrentSession
import dev.ignit.application.usecase.LogOut
import dev.ignit.domain.model.UserSession
import kotlinx.coroutines.launch

/**
 * Root of the app: a held [UserSession] shows the library, its absence shows the login screen.
 *
 * The persisted session is restored once on first composition, so a returning user lands directly
 * on the library instead of seeing the form flash by.
 */
@Composable
fun IgnitApp(
	loginViewModel: LoginViewModel,
	getCurrentSession: GetCurrentSession,
	logOut: LogOut,
) {
	val scope = rememberCoroutineScope()
	var session by remember { mutableStateOf<UserSession?>(null) }
	var restoring by remember { mutableStateOf(true) }

	LaunchedEffect(Unit) {
		session = getCurrentSession()
		restoring = false
	}

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
		)
		Spacer(Modifier.height(8.dp))
		Text(
			text = "Tu biblioteca llega en la próxima fase: por ahora la sesión ya quedó guardada.",
			style = MaterialTheme.typography.bodyMedium,
		)
		Spacer(Modifier.height(16.dp))
		Button(
			onClick = onLogOut,
			modifier = Modifier.testTag("logout-submit"),
		) {
			Text("Cerrar sesión")
		}
	}
}
