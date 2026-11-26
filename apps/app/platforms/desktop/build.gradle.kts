import org.jetbrains.compose.desktop.application.dsl.TargetFormat

plugins {
	alias(libs.plugins.kotlin.multiplatform)
	alias(libs.plugins.compose.multiplatform)
	alias(libs.plugins.compose.compiler)
}

kotlin {
	jvm()

	sourceSets {
		jvmMain.dependencies {
			implementation(project(":core:application"))
			implementation(project(":core:domain"))
			implementation(project(":adapters:driving:ui-compose"))
			implementation(project(":adapters:driven:http-api"))
			implementation(project(":adapters:driven:persistence"))
			implementation(project(":adapters:driven:auth-session"))
			implementation(project(":adapters:driven:preferences"))
			implementation(compose.desktop.currentOs)
			implementation(compose.material3)
			implementation(libs.kotlinx.coroutines.swing)
		}
	}
}

compose.desktop {
	application {
		mainClass = "dev.ignit.desktop.MainKt"
		nativeDistributions {
			targetFormats(TargetFormat.Dmg, TargetFormat.Msi, TargetFormat.Deb)
			packageName = "Ignit"
			packageVersion = "2.0.0"
		}
	}
}
