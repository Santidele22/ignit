# Ruta de desarrollo — Ignit app nativa (Kotlin/Compose)

Guía paso a paso para construir la app nativa siguiendo la arquitectura hexagonal de `apps/app/`.
Issue de origen: [Santidele22/ignit#2](https://github.com/Santidele22/ignit/issues/2).

> pensada como primera app mobile: cada fase produce algo visible y verificable
> antes de pasar a la siguiente. No se avanza con builds rojos.

## Fase 0 — Esqueleto que compila ( Starter)

1. ✅ Estructura hexagonal de carpetas (commit `5490713`).
2. ✅ Gradle: version catalog, `settings.gradle.kts`, `build.gradle.kts` por módulo, primero dominio/puertos/adaptadores stub (este commit).
3. ✅ **Primer build verde**: `:platforms:desktop` funciona con `jvm` (rápido, sin SDK). Luego `:platforms:android` produce un **APK debug** que abre un "Ignit" centrado en pantalla.
   - Verificación: `:core:domain:jvmTest`, `:platforms:desktop:compileKotlinJvm` y `:platforms:android:assembleDebug` en verde (`platforms/android/build/outputs/apk/debug/android-debug.apk`). Falta instalar el APK en el teléfono para verlo en vivo.
4. ⬜ CI mínimo opcional: workflow que corra `./gradlew :core:domain:jvmTest` por push.

## Fase 1 — Primer slice vertical: login (end-to-end de verdad)

La primera feature atraviesa **todas las capas**, es el mejor ejemplo de hexagonal:

1. `core/application`: puerto `AuthSession` + caso de uso `LogIn(email, pass)`.
2. `adapters/driven/http-api`: llamada real a la API (login del backend actual) con Ktor.
3. `adapters/driven/auth-session`: token en storage seguro (Android Keystore / Desktop).
4. `adapters/driving/ui-compose`: pantalla de login con estado (loading/error/success).
5. `platforms/*`: navegación raíz — pantalla login ⇒ biblioteca.

**Verificación**: iniciar sesión real desde la app con la cuenta de la web.
Espejo exacto del flujo web (`/login` + serverSession) — misma API, sin duplicar auth.

## Fase 2 — Biblioteca básica

1. Caso de uso `SyncLibrary` (ya esbozado en stub) contra `/api/library`.
2. Pantalla biblioteca: grilla/lista de libros con portada fija y título.
3. Proyecto del catálogo real en la web actual (así la app y la web muestran lo mismo).

## Fase 3 — Lector: el corazón de Ignit

1. Modelo de `ReadingProgress` en `core/domain` (página, capítulo, fecha).
2. Puerto de descarga de capítulos + persistencia SQLDelight (reemplaza el stub de `LocalProgressRepository`).
3. Pantalla lector paginado (Compose: `HorizontalPager`), modo vigilia, ficha.
4. Guardar progreso local + `syncPending()` hacia el backend.

## Fase 4 — Offline y sync real

1. Descargar libros completos (~300 KB/libro) a storage del dispositivo.
2. Cola de sincronización con reintento (resiliencia de red).
3. Resolver conflicto de progreso (web ↔ app, gana el más reciente).

## Fase 5 — Distribución

1. APK firmada con el mismo keystore del TWA (`apps/twa/android.keystore`) reutilizado para la firma de release.
2. `.aab` para Play Store y ficha (screenshots desde un emulador).
3. Desktop: instaladores (`Msi`/`Dmg`/`Deb`) con Compose Desktop — pruébalos en tu máquina.

## Fase 6 — Desktop + iOS (fase posterior)

1. Core (`domain` + `application`) ya es KMP: reutilizarlo directo.
2. Evaluar Compose Multiplatform iOS (Kotlin) vs nativa Swift — decisión con la issue #2 abierta.

## Reglas durante todo el camino

- **El hexágono es la ley**: los `import` de Ktor/Room/Compose no entran nunca a `core/`.
- Cada fase se cierra con build verde y prueba manual en el device real (o desktop).
- Commits pequeños por trabajo (work-unit commits), siempre en español en la conversation pero código/commits en inglés.
- Una vertical por vez; nada de "terminar todo el dominio antes de tocar UI".

## Aprender mientras construimos (primera app mobile)

Cada fase deja una nota corta `## Aprendizaje` al final de su propia carpeta
(`apps/app/docs/fase-N.md`) explicando el concepto nuevo que introdujo:
KMP targets, coroutines + flujos, Ktor, SQLDelight, Keystore, ciclo release.
