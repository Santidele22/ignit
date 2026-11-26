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
		}
		commonTest.dependencies {
			implementation(kotlin("test"))
			implementation(libs.kotlinx.coroutines.test)
		}
		jvmMain.dependencies {
			implementation(libs.kotlinx.serialization.json)
		}
	}
}

android {
	namespace = "dev.ignit.preferences"
	compileSdk = 35
	defaultConfig {
		minSdk = 26
	}
}
