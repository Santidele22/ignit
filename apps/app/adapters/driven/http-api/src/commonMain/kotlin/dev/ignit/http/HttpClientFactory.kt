// adapters/driven/http-api: HTTP client factory shared by every platform entry point.
package dev.ignit.http

import io.ktor.client.HttpClient

/**
 * Builds the app-wide [HttpClient]. The engine comes from the platform source set (OkHttp on
 * Android and Desktop); `expectSuccess` stays off so adapters decide how to map non-2xx answers.
 */
fun createIgnitHttpClient(): HttpClient = HttpClient { expectSuccess = false }
