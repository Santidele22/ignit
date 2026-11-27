# Fase 5 — Distribución Android (APK/AAB firmada + R8 + Play Store)

## Qué se configuró
- **Firma de release segura**: `signingConfigs.release` en `apps/app/platforms/android/build.gradle.kts` lee `IGNIT_KEYSTORE_PATH`, `IGNIT_KEYSTORE_PASSWORD`, `IGNIT_KEY_ALIAS` (`ignit` por defecto) y `IGNIT_KEY_PASSWORD` desde variables de entorno o `apps/app/keystore.properties` (ignorado en `.gitignore`), reutilizando `apps/twa/android.keystore`.
- **Hardening R8/ProGuard**: `isMinifyEnabled = true`, `isShrinkResources = true` y `apps/app/platforms/android/proguard-rules.pro` con reglas `keep` para `kotlinx.serialization`, Ktor y modelos de dominio/persistencia.
- **Desktop**: los instaladores Desktop (`.deb`/`.AppImage`/`.msi`/`.dmg`) salen de `apps/desktop/` (Tauri v2).

## Comandos de release
```bash
cd apps/app
IGNIT_KEYSTORE_PASSWORD="..." ./gradlew :platforms:android:assembleRelease :platforms:android:bundleRelease --no-daemon
apksigner verify --verbose platforms/android/build/outputs/apk/release/android-release.apk
```

## Aprendizaje
- Nunca commitear `keystore.properties` ni `.keystore`/`.jks`; fallar en `doFirst` con un mensaje explícito evita generar releases sin firma válida.
- **APK vs AAB**: la APK firmada sirve para distribución directa y pruebas en dispositivo (`adb install -r`), mientras que `.aab` (Android App Bundle) es el formato requerido por Google Play Console para optimizar splits por ABI/densidad.
