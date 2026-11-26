plugins {
	alias(libs.plugins.kotlin.multiplatform)
	alias(libs.plugins.android.library)
}

kotlin {
	androidTarget { compilations.all { kotlinOptions { jvmTarget = "17" } } }
	jvm()

	sourceSets {
		commonMain.dependencies {
			implementation(libs.kotlinx.coroutines.core)
		}
		commonTest.dependencies {
			implementation(kotlin("test"))
		}
	}
}
