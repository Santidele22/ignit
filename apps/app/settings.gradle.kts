pluginManagement {
	repositories {
		google()
		mavenCentral()
		gradlePluginPortal()
	}
}

dependencyResolutionManagement {
	repositoriesMode.set(RepositoriesMode.PREFER_PROJECT)
	repositories {
		google()
		mavenCentral()
	}
}

rootProject.name = "ignit-app"

include(":core:domain")
include(":core:application")
include(":adapters:driven:http-api")
include(":adapters:driven:persistence")
include(":adapters:driven:auth-session")
include(":adapters:driven:preferences")
include(":adapters:driving:ui-compose")
include(":platforms:android")
