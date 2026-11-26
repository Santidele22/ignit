// adapters/driven/http-api: HTTP client factory shared by every platform entry point.
package dev.ignit.http

import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpTimeout

/**
 * Builds the app-wide [HttpClient]. The engine comes from the platform source set (OkHttp on
 * Android and Desktop); `expectSuccess` stays off so adapters decide how to map non-2xx answers.
 *
 * Timeouts are explicit on purpose: without them a black-holed connection leaves the login screen
 * spinning with `loading = true` forever, which also blocks every retry.
 */
fun createIgnitHttpClient(): HttpClient = HttpClient {
	expectSuccess = false
	install(HttpTimeout) {
		connectTimeoutMillis = 15_000
		requestTimeoutMillis = 30_000
		socketTimeoutMillis = 30_000
	}
}
