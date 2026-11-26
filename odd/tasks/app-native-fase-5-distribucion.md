# App nativa Ignit — Fase 5: Distribución Android (APK/AAB firmada + Play Store)

Objetivo: configurar el build de release firmado de `apps/app/platforms/android` (APK firmada para instalación directa + `.aab` para Google Play Store) reutilizando el keystore de `apps/twa/android.keystore` (alias `ignit`) sin exponer secretos en git, preparar los assets de ficha (ícono adaptativo, splash y screenshots desde el emulador `ignit_pixel`) y dejar documentado el ciclo de release.
Nota sobre Desktop: los instaladores Desktop (`.deb`/`.AppImage`/`.msi`/`.dmg`) se producen en `apps/desktop/` (Tauri v2, ver `odd/tasks/desktop-tauri-app.md` T5), no desde KMP.
Dependencia previa: `odd/tasks/app-native-fase-4-offline-sync.md` completada.
Test runner: `cd apps/app && JAVA_HOME=/home/aegir/.bubblewrap/jdk/jdk-17.0.11+9 ./gradlew :platforms:android:assembleRelease :platforms:android:bundleRelease --no-daemon`

## Specs

- S1 (T1): Configuración de firma de release segura en `apps/app/platforms/android/build.gradle.kts` — leer `IGNIT_KEYSTORE_PATH`, `IGNIT_KEYSTORE_PASSWORD`, `IGNIT_KEY_ALIAS` (default `ignit`) y `IGNIT_KEY_PASSWORD` desde variables de entorno o `apps/app/keystore.properties` (ignorado en `apps/app/.gitignore`), apuntando por defecto al keystore existente (`apps/twa/android.keystore`). Regla de seguridad: **nunca** commitear `.keystore`, `.jks`, `.keystore-pass` ni `keystore.properties`, ni imprimir contraseñas en logs. Checks: `git status` limpio de secretos y `:platforms:android:assembleRelease` fallando con mensaje claro si faltan credenciales.
- S2 (T2): Hardening de release Android — habilitar `isMinifyEnabled = true` y `isShrinkResources = true` con `proguard-rules.pro` (reglas `keep` para Ktor/kotlinx.serialization/SQLDelight), `applicationId = "dev.ignit.app"`, bumping ordenado de `versionCode`/`versionName`, ícono adaptativo de Ignit (`mipmap-*`) y tema de arranque (`themes.xml` con fondo `#04050A`). Checks: `:platforms:android:assembleRelease` y `:platforms:android:bundleRelease` en verde; verificar firma con `apksigner verify --verbose`.
- S3 (T3): Verificación real de release — instalar la APK de release firmada (`android-release.apk`) en el emulador `ignit_pixel` (y/o teléfono físico) y comprobar flujo completo sin crashes de R8/ProGuard (login → biblioteca → lector Vigilia → modo avión offline). Checks: `adb install -r` + smoke test end-to-end en release.
- S4 (T4): Assets para Play Store y documentación — capturar screenshots limpios en `ignit_pixel` (`adb exec-out screencap -p`) de Login, Biblioteca y Lector (guardados en `apps/app/docs/store/`), escribir `apps/app/docs/fase-5.md` (`## Aprendizaje`: keystore, R8/ProGuard, APK vs AAB, checklist de subida a Play Console) y actualizar `apps/app/ROADMAP.md` (marcando Fase 5 y aclarando que los instaladores Desktop salen de `apps/desktop/` Tauri).

## Tasks

- T1 [S1] · `apps/app` · configurar `signingConfigs.release` vía env / `keystore.properties` (gitignored) y blindar `.gitignore` contra secretos (surfaces: `apps/app/.gitignore`, `apps/app/platforms/android/build.gradle.kts`) · status: pending
- T2 [S2] · `apps/app/platforms/android` · habilitar R8/minify + `proguard-rules.pro`, ícono adaptativo y tema `#04050A`, compilar y verificar firma de APK y `.aab` con `apksigner` (surfaces: `apps/app/platforms/android/**`) · status: pending
- T3 [S3] · `verificación release` · instalar `android-release.apk` en `ignit_pixel` y correr smoke test completo (login, biblioteca, lector, offline) verificando que R8 no rompa serialización (surfaces: `odd/tasks/app-native-fase-5-distribucion.md`) · status: pending
- T4 [S4] · `docs` · capturar screenshots para Play Store en `apps/app/docs/store/`, crear `apps/app/docs/fase-5.md` y actualizar `apps/app/ROADMAP.md` (surfaces: `apps/app/docs/**`, `apps/app/ROADMAP.md`) · status: pending

## Log

- L1 (usuario, verbatim): «documenta Fase 5 (Distribución: APK/AAB firmada con el keystore de TWA + instaladores Desktop). con odd para el mobile»
- L2 (exploración TWA): `apps/twa/twa-manifest.json` registra `signingKey.alias = "ignit"`, `themeColor = "#04050A"` y el keystore en `apps/twa/android.keystore`. Los instaladores Desktop quedan cubiertos por `odd/tasks/desktop-tauri-app.md` (T5, Tauri v2).

## Risk

- T1/T2: riesgo alto item 2 (seguridad: credenciales de firma / keystore) e item 5 (delivery/release: R8/ProGuard puede romper serialización Ktor/JSON si faltan reglas `keep`). Mitigación: secretos solo por env o `keystore.properties` gitignored, verificación con `apksigner verify` y smoke test obligatorio en `ignit_pixel` con el APK release minificado (T3).
