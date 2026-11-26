// adapters/driving/ui-compose: image loading. One Coil loader with a Ktor fetcher for cover URLs.
package dev.ignit.ui

import androidx.compose.runtime.Composable
import coil3.ImageLoader
import coil3.compose.setSingletonImageLoaderFactory
import coil3.network.ktor3.KtorNetworkFetcherFactory

/**
 * Installs the singleton Coil loader used by every `AsyncImage` in the app.
 *
 * The Ktor network fetcher is registered explicitly instead of relying on `ServiceLoader`
 * discovery, which does not exist on every Kotlin/Native target: without it a `coverUrl`
 * would silently never load. The default Ktor engine comes from the platform module that also
 * hosts the HTTP adapter.
 */
@Composable
fun IgnitImageLoader() {
	setSingletonImageLoaderFactory { context ->
		ImageLoader.Builder(context)
			.components { add(KtorNetworkFetcherFactory()) }
			.build()
	}
}
