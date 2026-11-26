plugins {
	alias(libs.plugins.kotlin.multiplatform)
	alias(libs.plugins.android.library)
	alias(libs.plugins.compose.multiplatform)
	alias(libs.plugins.compose.compiler)
}

kotlin {
	androidTarget { compilations.all { kotlinOptions { jvmTarget = "17" } } }
	jvm()

	sourceSets {
		commonMain.dependencies {
			implementation(project(":core:application"))
			implementation(project(":core:domain"))
			implementation(compose.runtime)
			implementation(compose.foundation)
			implementation(compose.material3)
			implementation(libs.androidx.lifecycle.viewmodel.compose)
			implementation(libs.koin.compose)
		}
		commonTest.dependencies {
			implementation(kotlin("test"))
			implementation(libs.kotlinx.coroutines.test)
		}
	}
}

android {
	namespace = "dev.ignit.ui"
	compileSdk = 35
	defaultConfig {
		minSdk = 26
	}
}
