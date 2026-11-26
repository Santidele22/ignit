# Fase 0 — Esqueleto que compila (Starter)

Estado: completado (`:core:domain:jvmTest`, `:platforms:desktop:compileKotlinJvm` y `:platforms:android:assembleDebug` en verde).

## Qué quedó armado

- Gradle Wrapper (`8.11.1`) y `gradle.properties` / `.gitignore` propios de `apps/app/`.
- Repositorios en `settings.gradle.kts` (`google()`, `mavenCentral()`, `gradlePluginPortal()`).
- Configuración de `android { namespace; compileSdk = 35; minSdk = 26 }` en todos los módulos KMP que declaran `androidTarget()`.
- Primer test unitario en `core/domain/src/commonTest/kotlin/dev/ignit/domain/model/BookTest.kt`.
- Entry points mínimos en `platforms/desktop` (`Main.kt`) y `platforms/android` (`MainActivity.kt`) mostrando `"Ignit"` centrado.

## Aprendizaje

1. **KMP Targets (`jvm()` vs `androidTarget()`)**: en Kotlin Multiplatform cada módulo declara qué plataformas compila. `core/` y `adapters/` compilan tanto para JVM (Desktop) como para Android, compartiendo el código de `commonMain` sin duplicarlo.
2. **Gradle Version Catalog (`gradle/libs.versions.toml`)**: centraliza versiones, librerías y plugins en un solo lugar, evitando desfasajes entre módulos.
3. **`api` vs `implementation` en arquitectura hexagonal**: `core:application` expone puertos cuyas firmas usan modelos de `core:domain` (como `Book`). Por eso `core:application` declara `api(project(":core:domain"))`: así los adaptadores que dependen de `application` ven los tipos del dominio sin acoplarse innecesariamente.
4. **SDK local y JDK**: Android Gradle Plugin 8.9.1 requiere JDK 17+ (en esta máquina usamos el JDK 17 de `~/.bubblewrap/jdk/`) y `local.properties` (ignorado en git) apunta `sdk.dir` al Android SDK local.
