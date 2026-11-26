// adapters/driving/ui-compose: test. The view model is a plain class, so it runs without a UI harness.
package dev.ignit.ui

import dev.ignit.application.port.AuthGateway
import dev.ignit.application.port.AuthSession
import dev.ignit.application.usecase.LogIn
import dev.ignit.domain.model.AuthException
import dev.ignit.domain.model.UserSession
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

private val santi = UserSession("usr_1", "a@b.ar", "A", "tok_1")

private class FakeGateway(private val result: Result<UserSession>) : AuthGateway {
	override suspend fun signIn(email: String, password: String): UserSession = result.getOrThrow()
}

private class FakeSession : AuthSession {
	private var stored: UserSession? = null
	override suspend fun load(): UserSession? = stored
	override suspend fun save(session: UserSession) { stored = session }
	override suspend fun clear() { stored = null }
}

private fun viewModelFor(result: Result<UserSession>): LoginViewModel =
	LoginViewModel(LogIn(FakeGateway(result), FakeSession()))

class LoginViewModelTest {
	@Test
	fun successfulLoginPublishesTheSessionAndStopsLoading() = runTest {
		val viewModel = viewModelFor(Result.success(santi))
		viewModel.onEmailChange("a@b.ar")
		viewModel.onPasswordChange("pw")

		viewModel.submit()

		assertEquals(santi, viewModel.session)
		assertNull(viewModel.error)
		assertFalse(viewModel.loading)
	}

	@Test
	fun rejectedCredentialsSurfaceTheUseCaseMessage() = runTest {
		val viewModel = viewModelFor(Result.failure(AuthException("Invalid email or password")))
		viewModel.onEmailChange("a@b.ar")
		viewModel.onPasswordChange("wrong")

		viewModel.submit()

		assertEquals("Invalid email or password", viewModel.error)
		assertNull(viewModel.session)
		assertFalse(viewModel.loading)
	}

	@Test
	fun editingAFieldClearsThePreviousError() = runTest {
		val viewModel = viewModelFor(Result.failure(AuthException("Invalid email or password")))
		viewModel.onEmailChange("a@b.ar")
		viewModel.onPasswordChange("wrong")
		viewModel.submit()

		viewModel.onPasswordChange("otra")

		assertNull(viewModel.error)
	}

	@Test
	fun loggingOutForgetsTheTypedPassword() = runTest {
		val viewModel = viewModelFor(Result.success(santi))
		viewModel.onEmailChange("a@b.ar")
		viewModel.onPasswordChange("pw-typed")
		viewModel.submit()

		viewModel.clearSession()

		assertNull(viewModel.session)
		assertEquals("", viewModel.password)
	}
}
