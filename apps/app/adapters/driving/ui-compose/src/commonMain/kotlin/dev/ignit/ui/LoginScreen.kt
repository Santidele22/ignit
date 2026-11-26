// adapters/driving/ui-compose: driving adapter. Login form rendered from LoginViewModel state.
package dev.ignit.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import dev.ignit.domain.model.UserSession
import kotlinx.coroutines.launch

/**
 * Sign-in screen. Reports the signed-in user once through [onLoggedIn]; the root app owns the
 * navigation that follows.
 */
@Composable
fun LoginScreen(viewModel: LoginViewModel, onLoggedIn: (UserSession) -> Unit) {
	val scope = rememberCoroutineScope()
	val canSubmit = !viewModel.loading && viewModel.email.isNotBlank() && viewModel.password.isNotBlank()

	LaunchedEffect(viewModel.session) {
		viewModel.session?.let(onLoggedIn)
	}

	Column(
		modifier = Modifier.fillMaxSize().padding(24.dp),
		verticalArrangement = Arrangement.Center,
		horizontalAlignment = Alignment.CenterHorizontally,
	) {
		Text(
			text = "Ignit",
			style = MaterialTheme.typography.headlineLarge,
		)
		Spacer(Modifier.height(8.dp))
		Text(
			text = "Ingresá con tu cuenta para abrir tu biblioteca.",
			style = MaterialTheme.typography.bodyMedium,
		)
		Spacer(Modifier.height(24.dp))

		OutlinedTextField(
			value = viewModel.email,
			onValueChange = viewModel::onEmailChange,
			label = { Text("Email") },
			singleLine = true,
			keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
			modifier = Modifier.fillMaxWidth().testTag("login-email"),
		)
		Spacer(Modifier.height(12.dp))

		OutlinedTextField(
			value = viewModel.password,
			onValueChange = viewModel::onPasswordChange,
			label = { Text("Contraseña") },
			singleLine = true,
			visualTransformation = PasswordVisualTransformation(),
			keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
			modifier = Modifier.fillMaxWidth().testTag("login-password"),
		)
		Spacer(Modifier.height(24.dp))

		Button(
			onClick = { scope.launch { viewModel.submit() } },
			enabled = canSubmit,
			modifier = Modifier.fillMaxWidth().testTag("login-submit"),
		) {
			Text("Entrar")
		}

		if (viewModel.loading) {
			Spacer(Modifier.height(16.dp))
			CircularProgressIndicator()
		}

		viewModel.error?.let { message ->
			Spacer(Modifier.height(16.dp))
			Text(
				text = message,
				color = MaterialTheme.colorScheme.error,
				style = MaterialTheme.typography.bodyMedium,
				modifier = Modifier.testTag("login-error"),
			)
		}
	}
}
