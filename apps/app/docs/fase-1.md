# Fase 1 — Primer slice vertical: login (end-to-end)

Estado: implementado en la rama `feat/app-native-fase-1-login`. El login atraviesa las cinco capas del hexágono y habla con el backend de producción (`https://ignit.ignit677.workers.dev`), el mismo que usa la web.

## Qué quedó armado

### Dominio y puertos (`core/`)

- `core/domain`: `UserSession(userId, email, name, token)` y `AuthException(message)`.
- `core/application`: puertos `AuthGateway` (`signIn`) y `AuthSession` (`load` / `save` / `clear`), y los casos de uso `LogIn`, `GetCurrentSession` y `LogOut`.
- `LogIn` recorta el email, rechaza campos vacíos **antes** de tocar la red, y persiste la sesión solo cuando `signIn` salió bien. Un login fallido deja intacta la sesión que ya estaba guardada.

### Adaptadores driven

- `adapters/driven/http-api`: `KtorAuthGateway` hace `POST {baseUrl}/api/auth/sign-in/email` con `Content-Type: application/json`, `Origin: {baseUrl}` y body `{"email","password"}` — espejo exacto del flujo web. En 2xx toma el `token` del body o, si no viene, la cookie `better-auth.session_token` del `Set-Cookie`, más `user.id/email/name`. En 4xx/5xx propaga el `message` del backend tal cual (por ejemplo `Invalid email or password`).
- `adapters/driven/auth-session`: `AuthSession` real por plataforma.
  - Android: `KeystoreAuthSession` cifra con `AES/GCM/NoPadding` usando una clave del Android Keystore y deja en `SharedPreferences` solo IV + ciphertext en Base64.
  - Desktop: `FileAuthSession` escribe `~/.config/ignit/session.json` de forma atómica y con permisos `rw-------` (dir `rwx------`).
  - `SessionCodec` compartido en `commonMain` codifica/decodifica la sesión y devuelve `null` ante datos corruptos en vez de romper.

### Adaptador driving y plataformas

- `adapters/driving/ui-compose`: `LoginViewModel` (estado `loading` / `error` / `success`), `LoginScreen` (email, contraseña, spinner, error) e `IgnitApp` con la navegación raíz **Login ⇒ Biblioteca** y un placeholder de biblioteca que muestra el usuario logueado y el botón de cerrar sesión. La UI solo llama casos de uso.
- `platforms/android` y `platforms/desktop`: composition root manual (adapters adentro, casos de uso hacia la UI), permiso `INTERNET` en el manifest y `BASE_URL` apuntando a producción.

## Tests

| Módulo | Test | Qué fija |
| --- | --- | --- |
| `core:domain` | `UserSessionTest` | La forma de la sesión y que `AuthException` transporte el mensaje del backend. |
| `core:application` | `LogInTest` | Trim del email, rechazo de email/contraseña vacíos sin llamar al gateway, persistencia solo en éxito, mensaje del backend ante credenciales inválidas, sesión previa intacta tras un fallo. |
| `core:application` | `SessionUseCasesTest` | `GetCurrentSession` devuelve lo que hay (o `null`) y `LogOut` limpia. |
| `adapters:driven:http-api` | `KtorAuthGatewayTest` (MockEngine) | Método, path, header `Origin`, body exacto, token por body, token por cookie, `401` con mensaje del backend, `500` con fallback, fallo de transporte envuelto. |
| `adapters:driven:auth-session` | `SessionCodecTest`, `FileAuthSessionTest` | Round-trip con caracteres raros, `null` ante datos corruptos, sobrescritura atómica, permisos POSIX. |

`KeystoreAuthSession` se prueba solo a nivel compilación + ejecución en el emulador: necesita un dispositivo real para el Keystore.

## Aprendizaje

1. **Ktor y el motor por plataforma.** `ktor-client-core` declara la API, pero el motor se elige por target: `ktor-client-okhttp` en `androidMain` y `jvmMain`. `HttpClient()` sin argumentos lo resuelve por `ServiceLoader` con lo que haya en el classpath, así que `createIgnitHttpClient()` es común y cada plataforma aporta su motor. Clave: `expectSuccess = false`, si no Ktor lanza excepción en los 4xx y se pierde el `message` del backend, que es justo lo que hay que mostrarle al usuario.
2. **Los códigos de error son parte del contrato.** El backend contesta `401 {"message":"Invalid email or password", ...}`. El adaptador no inventa texto: propaga ese `message` y solo cae a un mensaje en español cuando el cuerpo no es JSON parseable. Así la app y la web dicen lo mismo.
3. **Coroutines: `suspend` en los puertos, no callbacks.** Los tres casos de uso son `suspend` y devuelven `Result<T>` (`LogIn`) o el valor directo (`GetCurrentSession`). El detalle fino está en `LogIn`: `runCatching` atrapa también `CancellationException`, y ahí no hay que tragarla — si el usuario sale de la pantalla, la corrutina tiene que poder cancelarse. Por eso el try/catch es explícito y re-lanza la cancelación. No se usan `Flow`s todavía porque el login es una operación puntual; recién en la fase de biblioteca/sync tiene sentido un flujo observable.
4. **Estado de UI sin magia.** `LoginViewModel` es una clase común con `mutableStateOf` y setters privados: cualquier escritura pasa por un método, así el botón no necesita defenderse de dobles envíos y cambiar un campo limpia el error anterior. `IgnitApp` deriva la pantalla del estado (`session == null` ⇒ Login), no de una ruta explícita: menos piezas para una app de dos pantallas.
5. **Android Keystore: la clave no se exporta.** `AES/GCM/NoPadding` con una clave `KeyGenParameterSpec` (`BLOCK_MODE_GCM`, sin padding) generada dentro del Keystore. El ciphertext es inútil sin esa clave, que nunca sale del hardware/almacén del dispositivo. Dos consecuencias prácticas: GCM usa un **IV distinto por cada cifrado** (se guarda junto al ciphertext), y `load()` debe devolver `null` ante `AEADBadTagException` o `KeyPermanentlyInvalidatedException` (pasa si el usuario cambia el bloqueo de pantalla) en vez de crashear — la app simplemente vuelve a pedir login.
6. **Desktop no tiene Keystore.** La alternativa honesta es un archivo con permisos restrictivos: escritura atómica (temp + `ATOMIC_MOVE` en el mismo directorio) para no dejar un JSON a medias, `rw-------` en el archivo y `rwx------` en el directorio, y tolerancia a `UnsupportedOperationException` en sistemas de archivos que no son POSIX. No es equivalente al Keystore en seguridad, y por eso queda anotado como deuda para el empaquetado de la fase 5.

## Pendiente

- Iniciar sesión con una cuenta real de la web desde el emulador (requiere credenciales humanas). La conectividad end-to-end ya está probada: el emulador recibe del backend de producción el rechazo `Invalid email or password` ante credenciales inválidas.
- `CI` mínimo que corra `:core:domain:jvmTest`, `:core:application:jvmTest` y los tests de adaptadores por push.
