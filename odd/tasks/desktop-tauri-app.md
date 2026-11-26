# App Desktop Ignit — Tauri v2 (reutilizando `web/`)

Objetivo: construir la aplicación de escritorio oficial de Ignit en `apps/desktop/` usando Tauri v2 (Rust + WebView nativo) como shell sobre la web SSR (`https://ignit.ignit677.workers.dev` en prod / `http://localhost:4321` en dev), sumando capacidades nativas de escritorio (ventana dedicada, single-instance, almacenamiento offline local en Rust, instaladores `.deb`/`.AppImage`/`.msi`/`.dmg`), y al finalizar retirar el módulo app `:platforms:desktop` de KMP.
Toolchain verificada en la máquina: `rustc 1.98.1`, `cargo 1.98.1`, `webkit2gtk-4.1` (`2.52.6`).
Test runner: `cd apps/desktop/src-tauri && cargo test && cargo check` (y `pnpm --dir web test` para cambios en `web/`).

## Specs

- S1 (T1): Scaffold Tauri v2 en `apps/desktop/` (`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/lib.rs`, `src-tauri/src/main.rs`, íconos de Ignit y `apps/desktop/README.md`). Ventana principal arranca en `/biblioteca` (`http://localhost:4321/biblioteca` en dev, `https://ignit.ignit677.workers.dev/biblioteca` en release), manteniendo sesión/cookies de Neon Auth y el lector Vigilia sin duplicar frontend. Checks: `cargo check` en verde y ventana abriendo en vivo.
- S2 (T2): Comportamiento nativo de escritorio — tamaño/posición persistente (`tauri-plugin-window-state`), instancia única (`tauri-plugin-single-instance`), apertura de enlaces externos fuera de `ignit.ignit677.workers.dev` en el navegador del sistema (`tauri-plugin-opener`) y atajos básicos (recargar, zoom lectura, pantalla completa). Checks: `cargo check` + prueba manual abriendo/cerrando y reabriendo la ventana.
- S3 (T3): Adaptación mínima en `web/` cuando corre dentro de Tauri (`'__TAURI_INTERNALS__' in window`) — ocultar banners/CTAs de instalación PWA que no aplican en desktop nativo y verificar que `web/astro.config.mjs` (CSP / headers) no bloquee el WebView de Tauri. Checks: `pnpm --dir web test` y `pnpm --dir web build` en verde.
- S4 (T4): Puente nativo Rust para modo offline — comandos Tauri (`save_offline_book`, `read_offline_book`, `list_offline_books`, `delete_offline_book`) persistiendo JSON/archivos en `app_data_dir()/books/` con validación segura de `book_id` (sin path traversal), más pantalla local de fallback offline si la app arranca sin conexión. Checks: `cargo test` (incluyendo test de path traversal y roundtrip de lectura/escritura).
- S5 (T5): Empaquetado y verificación real — `cargo tauri build` generando `.deb` y `.AppImage` en Linux (config lista para `.msi`/`.dmg`), instalación/ejecución del paquete generado en esta PC verificando login y lectura en Vigilia. Checks: artefactos generados en `apps/desktop/src-tauri/target/release/bundle/` y smoke test manual.
- S6 (T6): Retiro de `:platforms:desktop` en KMP — **solo después de verificar T5 en vivo**: eliminar `apps/app/platforms/desktop/` y remover `include(":platforms:desktop")` de `apps/app/settings.gradle.kts`, actualizando `apps/app/README.md` y `apps/app/ROADMAP.md`. Nota técnica: conservar el target `jvm()` en `core/domain`, `core/application` y adaptadores para que los tests rápidos (`./gradlew :core:domain:jvmTest`) sigan corriendo sin Android SDK. Checks: `cd apps/app && JAVA_HOME=/home/aegir/.bubblewrap/jdk/jdk-17.0.11+9 ./gradlew :core:domain:jvmTest :core:application:jvmTest :platforms:android:assembleDebug --no-daemon`.

## Tasks

- T1 [S1] · `apps/desktop` · scaffold Tauri v2 apuntando a `web/` SSR (`/biblioteca`), íconos y README (surfaces: `apps/desktop/**`) · status: pending
- T2 [S2] · `apps/desktop/src-tauri` · plugins nativos (`window-state`, `single-instance`, `opener`) y atajos de ventana (surfaces: `apps/desktop/src-tauri/**`) · status: pending
- T3 [S3] · `web` · detección de Tauri para ocultar UX de PWA y verificación CSP/WebView + tests (surfaces: `web/src/**`, `web/astro.config.mjs`) · status: pending
- T4 [S4] · `apps/desktop/src-tauri` · comandos Rust para cache offline de libros (`app_data_dir/books`) + fallback sin red + `cargo test` (surfaces: `apps/desktop/**`) · status: pending
- T5 [S5] · `apps/desktop` · build de instaladores (`.deb`/`.AppImage`) y verificación manual completa en Linux (surfaces: `apps/desktop/**`) · status: pending
- T6 [S6] · `apps/app` · retirar `:platforms:desktop` de KMP (manteniendo `jvm()` en `core/` para tests) y actualizar docs/roadmap (surfaces: `apps/app/settings.gradle.kts`, `apps/app/platforms/desktop/**`, `apps/app/README.md`, `apps/app/ROADMAP.md`) · status: pending

## Log

- L1 (usuario, verbatim): «Planeamos la aplicacion desktop que va estar en tauri para reutilizar web.»
- L2 (decisión arquitectura): Usuario eligió (1) Shell Tauri v2 sobre la web SSR (`https://ignit.ignit677.workers.dev`) + puente nativo Rust para offline/atajos/ventana dedicada, y (2) crear `apps/desktop/` dejando `apps/app/platforms/desktop` mientras tanto, con una tarea final (T6) para reemplazar y eliminar el target app desktop de KMP cuando Tauri esté listo.
- L3 (exploración): `web/astro.config.mjs` usa `output: 'server'` con `@astrojs/cloudflare` y proxy `/api/auth`. La máquina ya cuenta con `rustc 1.98.1`, `cargo 1.98.1` y `webkit2gtk-4.1` (`2.52.6`).
