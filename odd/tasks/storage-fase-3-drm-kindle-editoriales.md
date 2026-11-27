# Storage & DRM — Fase 3: Protección Editorial Anti-Piratería estilo Kindle (`Tier 3`)

Objetivo: proteger libros de licencias cerradas y futuras alianzas con editoriales contra piratería y redistribución no autorizada aplicando la estrategia Kindle: cero descarga de PDFs/archivos en claro, 1 copia `.igb` encriptada por título editorial, licencias ligadas a dispositivo (*device-bound key wrapping* en Android Keystore / OS Keychain), descifrado justo-a-tiempo por capítulo en RAM, `FLAG_SECURE` en Android y marca de agua forense invisible.
Índice maestro: `odd/tasks/local-first-storage-igb-drm.md` · Dependencias previas: `odd/tasks/storage-fase-1-igb1-compacto.md`, `odd/tasks/storage-fase-2-local-first-sync.md` · Relacionado: `odd/tasks/etapa-1-legal-editoriales.md`.
Branch: `feat/storage-fase-3-drm-kindle` (pendiente de crear al autorizar) · Entrega: commits por unidad de trabajo.
Test runners:
- Backend: `cd backend && pnpm test`
- Web: `cd web && pnpm test`
- Desktop (Rust): `cd apps/desktop/src-tauri && cargo test`
- Mobile (KMP): `cd apps/app && JAVA_HOME=/home/aegir/.bubblewrap/jdk/jdk-17.0.11+9 ./gradlew :core:domain:jvmTest :core:application:jvmTest :adapters:driven:persistence:jvmTest :platforms:android:assembleDebug --no-daemon`

## Specs

- **S1 — Registro de dispositivos y revocación (`devices` + `licenses`)**:
  - Tabla `devices` (`id`, `userId`, `platform` [`desktop_linux`|`desktop_win`|`desktop_mac`|`android`|`ios`], `name`, `publicKeyPem`, `createdAt`, `lastSeenAt`, `revokedAt`) con límite configurable por cuenta (default: `MAX_DEVICES_PER_USER = 5`).
  - Tabla `licenses` (`id`, `userId`, `bookId`, `deviceId`, `wrappedCek`, `expiresAt`, `revokedAt`, `issuedAt`, `signature`).
  - Endpoints: `POST /devices/register`, `GET /devices`, `DELETE /devices/:id` (revoca dispositivo y sus licencias), `POST /licenses/acquire` (emite `wrappedCek` solo si el usuario tiene entitlement válido para el libro y el dispositivo no está revocado).
  - Checks: tests unitarios e integración cubriendo límite de dispositivos (6to rechazado), revocación inmediata y rechazo de licencia sin entitlement.

- **S2 — *Device-bound Key Wrapping* de `CEK` + bloqueo estricto de distribución**:
  - Cada libro editorial (`Tier 3`) se almacena como **1 sola copia `.igb` encriptada** en Object Storage con una `CEK` (AES-256) única por título, generada y custodiada en el backend (envuelta con una KEK maestra en env/KMS).
  - Al emitir licencia para un dispositivo, el backend envuelve la `CEK` con la `publicKey` del dispositivo (RSA-OAEP-SHA256 o X25519+HKDF+AES-KW, estándar nativo en Node, Rust y Android Keystore).
  - Un archivo `.igb` + SQLite copiado a otra PC o celular es **indescifrable** sin la clave privada del dispositivo registrado.
  - Endpoints de descarga/exportación de archivo original (`/download`) devuelven `403 Forbidden` para `Tier 2` y `Tier 3` (solo permitidos para `Tier 1` si aplica).
  - Checks: test verificando que la `CEK` envuelta para dispositivo A no puede desenvolverse con la clave privada de dispositivo B, y que `/download` bloquea Tier 2 y Tier 3.

- **S3 — Desktop (Tauri/Rust): Keychain del SO + descifrado justo-a-tiempo por capítulo en RAM**:
  - Al registrar Desktop, generar par de claves asimétricas y guardar la clave privada en el almacenamiento seguro del SO (Linux Secret Service / macOS Keychain / Windows Credential Manager vía crate `keyring`).
  - Extender `IGB1` (bit 2 de `flags` = chunked por capítulo) para que cada capítulo tenga su propio IV derivado (`nonce_cap = HKDF/XOR(base_nonce, chapter_index)`).
  - Al abrir un libro Tier 3, solo el capítulo activo se descifra en RAM y se limpia/descarta (`zeroize`) al cambiar de capítulo o cerrar el visor; nunca se escribe texto plano en disco.
  - Checks: `cargo test` cubriendo wrapping/unwrapping, descifrado por capítulo individual y rechazo ante licencia expirada o revocada.

- **S4 — Mobile (KMP/Android): Android Keystore (TEE) + `FLAG_SECURE` + descifrado por capítulo**:
  - Generar y custodiar la clave privada del dispositivo dentro de **Android Keystore** (`AndroidKeyStore` provider, hardware-backed cuando esté disponible, no exportable).
  - Desenvolver `CEK` en memoria para descifrar únicamente el capítulo visible en `ReaderScreen`.
  - Activar `WindowManager.LayoutParams.FLAG_SECURE` en la `Activity` cuando el libro abierto es `Tier 3` (bloquea capturas de pantalla y grabación de pantalla), y restaurarlo al salir de libros Tier 3.
  - Checks: tests JVM de descifrado por capítulo + verificación en emulador/dispositivo de `FLAG_SECURE` activo en Tier 3 e inactivo en Tier 1.

- **S5 — Protecciones de visor (copy/paste, watermark forense) y política Web para Tier 3**:
  - **Bloqueo de copia masiva**: en Tier 3 deshabilitar `select-all` y exportación completa; permitir únicamente subrayados/citas cortas (ej. límite configurable de caracteres por cita dentro de la app).
  - **Watermark forense invisible**: al renderizar capítulos de Tier 3, inyectar una huella forense determinista ligada a `userId + licenseId` (ej. secuencia invisible/esteganográfica no intrusiva para screen readers) que permita identificar filtraciones en acuerdos editoriales.
  - **Política Web (honesta frente a DevTools)**: en navegador web los libros Tier 3 **no se cachean offline en IndexedDB**; se sirven únicamente por streaming autenticado capítulo a capítulo con expiración corta. La lectura offline protegida queda reservada a Desktop y Mobile nativos (estrategia Kindle).
  - Checks: tests unitarios de verificación de watermark (encode + extract `userId`), tests de bloqueo de caché IndexedDB para Tier 3 en `web/`, y tests de límite de copia en el visor.

## Tasks

- T1 [S1] · `backend` · Entidades y endpoints de `devices` (registro, listado, revocación, límite por cuenta) y `licenses` + migraciones DB (surfaces: `backend/src/devices/**`, `backend/src/licenses/**`) · status: pending
- T2 [S2] · `backend` · Custodia de `CEK` por libro editorial, *device-bound key wrapping* en `/licenses/acquire`, soporte de `.igb` chunked por capítulo y bloqueo estricto `403` de descarga/exportación para Tier 2 y Tier 3 (surfaces: `backend/src/licenses/**`, `backend/src/books/igb/**`, `backend/src/books/books.controller.ts`, `backend/src/books/books.service.ts`) · status: pending
- T3 [S3] · `apps/desktop` · Custodia de clave privada en OS Keychain (`keyring`), desenvolvimiento de `CEK` y descifrado justo-a-tiempo por capítulo en RAM con limpieza de buffers (`zeroize`) (surfaces: `apps/desktop/src-tauri/src/**`) · status: pending
- T4 [S4] · `apps/app` · Custodia de clave privada en Android Keystore (TEE), desenvolvimiento de `CEK`, descifrado por capítulo en RAM y `FLAG_SECURE` dinámico en `ReaderScreen` para Tier 3 (surfaces: `apps/app/platforms/android/**`, `apps/app/adapters/driven/**`, `apps/app/adapters/driving/**`) · status: pending
- T5 [S5] · `web` + `apps/desktop` + `apps/app` · Bloqueo de copia masiva en Tier 3, watermark forense invisible (`userId + licenseId`) compatible con accesibilidad y política Web de streaming por capítulo sin caché offline en IndexedDB (surfaces: `web/src/features/book/reader/**`, `web/src/features/library/lib/**`, `apps/app/adapters/driving/ui-compose/**`) · status: pending

## Log

- **L1 (2026-11-27, usuario, verbatim)**: «haz el odd de todas las fases» (desglose de `odd/tasks/local-first-storage-igb-drm.md`).
- **Contexto**: Preparación técnica para alianzas editoriales (ver `odd/tasks/etapa-1-legal-editoriales.md`) con protección anti-piratería estilo Kindle y AES-256-GCM estándar sin UniFFI.
