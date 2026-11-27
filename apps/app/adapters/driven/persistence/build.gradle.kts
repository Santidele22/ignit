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
			implementation(libs.sqldelight.coroutines)
			implementation(libs.kotlinx.serialization.json)
		}
		commonTest.dependencies {
			implementation(kotlin("test"))
		}
	}
}

android {
	namespace = "dev.ignit.local"
	compileSdk = 35
	defaultConfig {
		minSdk = 26
	}
}
