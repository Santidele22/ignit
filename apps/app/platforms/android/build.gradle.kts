plugins {
	alias(libs.plugins.kotlin.multiplatform)
	alias(libs.plugins.android.application)
	alias(libs.plugins.compose.multiplatform)
	alias(libs.plugins.compose.compiler)
}

kotlin {
	androidTarget {
		compilations.all { kotlinOptions { jvmTarget = "17" } }
	}

	sourceSets {
		androidMain.dependencies {
			implementation(project(":adapters:driving:ui-compose"))
			implementation(project(":adapters:driven:http-api"))
			implementation(project(":adapters:driven:persistence"))
			implementation(project(":adapters:driven:auth-session"))
			implementation(compose.material3)
			implementation(libs.androidx.activity.compose)
		}
	}
}

android {
	compileSdk = 35
	namespace = "dev.ignit.android"
	defaultConfig {
		applicationId = "dev.ignit.app"
		versionCode = 2
		versionName = "2.0.0-native"
		minSdk = 26
		targetSdk = 35
	}
	compileOptions {
		sourceCompatibility = JavaVersion.VERSION_17
		targetCompatibility = JavaVersion.VERSION_17
	}
}
