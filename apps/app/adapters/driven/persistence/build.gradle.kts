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
		}
	}
}

sqldelight {
	databases {
		create("IgnitLocal") {
			package.set("dev.ignit.local")
		}
	}
}
