plugins {
	alias(libs.plugins.kotlin.multiplatform)
	alias(libs.plugins.android.library)
}

kotlin {
	androidTarget { compilations.all { kotlinOptions { jvmTarget = "17" } } }
	jvm()

	sourceSets {
		commonMain.dependencies {
			implementation(project(":core:application"))
			implementation(libs.ktor.client.core)
			implementation(libs.ktor.client.content.negotiation)
			implementation(libs.ktor.serialization.kotlinx.json)
		}
		androidMain.dependencies {
			implementation(libs.ktor.client.okhttp)
		}
		jvmMain.dependencies {
			implementation(libs.ktor.client.okhttp)
		}
		commonTest.dependencies {
			implementation(kotlin("test"))
			implementation(libs.ktor.client.mock)
			implementation(libs.kotlinx.coroutines.test)
		}
	}
}

android {
	namespace = "dev.ignit.http"
	compileSdk = 35
	defaultConfig {
		minSdk = 26
	}
}
