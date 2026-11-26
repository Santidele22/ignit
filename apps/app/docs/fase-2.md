# Fase 2 — Biblioteca básica

Estado: implementado en la rama `feat/app-native-fase-1-login`. La biblioteca consume el catálogo real de producción (`GET /api/books`) y reemplaza el placeholder de Fase 1.

## Qué quedó armado

### Dominio y puertos

- `Book` ahora refleja el catálogo real: `author`, `kind`, `coverUrl` (nullable) y `published`, además de `id`, `title`. `totalPages` se alimenta del campo `filePages` que sí manda la API; `roomId` no tiene contraparte en el backend y queda como campo local.
- `LibraryRepository.fetchLibrary(mine: Boolean = false, kind: String? = null)` y `SyncLibrary(mine, kind)` separan catálogo público de biblioteca personal y permiten filtrar por estante.
- **`UserSession` ganó `sessionCookie`**: el par `nombre=valor` completo de la cookie de sesión. Es la credencial que el backend acepta (ver Aprendizaje 1).

### Adaptadores

- `KtorLibraryRepository` llama `GET {baseUrl}/api/books` con `?mine=true` y `?kind=` solo cuando corresponden, manda `Cookie` desde `AuthSession`, y acepta **array pelado o envelope `{ items, … }`** (el backend devuelve array si no se mandan `offset`/`limit`).
- `KtorAuthGateway` pasó a guardar la cookie firmada del `Set-Cookie` como credencial (con prefijo `__Secure-` en producción, sin prefijo en localhost), y usa el `token` del body solo como fallback.
- `SessionCodec` persiste `sessionCookie` y **sigue decodificando sesiones viejas** sin ese campo: si hubiera devuelto `null`, cada instalación existente habría quedado deslogueada.

### UI

- `LibraryViewModel`: `scope` (catálogo / mi biblioteca), `kind`, `books`, `loading`, `error`; `load` no reentra y no se traga `CancellationException`. Una falla **no borra** los libros ya cargados.
- `LibraryScreen`: header con usuario y cerrar sesión, selector de alcance, chips de estante, grilla `LazyVerticalGrid` de tarjetas 2:3 con portada Coil y placeholder tipográfico, estados loading/error/vacío, y "Actualizar".
- Los chips de estante **se derivan de los libros cargados**, no de una lista fija.

## Tests

| Módulo | Test | Qué fija |
| --- | --- | --- |
| `core:application` | `SyncLibraryTest` | `(mine, kind)` por defecto, forwarding, `kind` en blanco → `null`, fallo → `Result.failure`. |
| `adapters:driven:http-api` | `KtorLibraryRepositoryTest` | query string, `Cookie` solo si hay sesión, array y envelope, `401` con mensaje del backend, fallo de transporte. |
| `adapters:driven:http-api` | `KtorLibraryRepositoryProductionPayloadTest` | El **payload real de producción** (dos libros capturados): `id` numérico, `filePages`, `coverUrl` nullable, campos ignorados. |
| `adapters:driven:http-api` | `KtorAuthGatewayTest` | La cookie firmada se guarda como credencial; el token del body sigue sirviendo de fallback. |
| `adapters:driven:auth-session` | `SessionCodecTest` | Round-trip con `sessionCookie` y **compatibilidad con payloads viejos**. |
| `adapters:driving:ui-compose` | `LibraryViewModelTest` | alcance/estante hacia el puerto, error que conserva libros, `availableKinds` derivado, `kindLabel`. |

## Aprendizaje

1. **El token del body no autentica; la cookie firmada sí.** Este fue el hallazgo caro de la fase. Better Auth devuelve `token` en el body del sign-in **y** setea una cookie cuyo valor es `token + "." + firma`. El backend resuelve la sesión con `auth.api.getSession({ headers })`, o sea lee y **verifica la firma** de la cookie (`backend/src/auth/guards/better-session.reader.ts`), y su configuración no incluye el plugin `bearer()` (`backend/src/auth/auth.ts:55`). Conclusión: guardar solo el `token` crudo habría dejado `?mine=true` en 401 para siempre. Hay que persistir el par `nombre=valor` de la cookie. Detalle práctico: en producción la cookie se llama `__Secure-better-auth.session_token` y en localhost `better-auth.session_token`, así que el nombre no se puede hardcodear — se guarda el par tal como vino.
2. **Un endpoint puede devolver dos formas.** El controller responde un array pelado, y un envelope `{ items, total, offset, limit }` cuando el cliente manda `offset`/`limit`. El parser acepta ambas en vez de asumir: es más barato que descubrirlo cuando la fase 3 pagine.
3. **La forma real del payload se verifica con `curl`, no con la imaginación.** Dos supuestos del plan cayeron contra producción: (a) los `kind` reales son `tecnico`, `terror_scifi`, `filosofia`, `ficcion`, `poesia` —no existe `no_tecnico`—, así que los chips fijos habrían mostrado estantes vacíos; (b) el total de páginas viaja como `filePages`, no `totalPages`, así que todos los libros marcaban 0. Ambos se corrigieron y quedaron fijados con un test que usa el payload real capturado.
4. **Los filtros de UI se derivan de los datos, no del enum que uno supone.** Si mañana alguien agrega el estante `ensayo`, la app lo muestra sin recompilar. El label se resuelve con un mapa conocido + humanizado genérico (`novela_negra` → "Novela negra").
5. **Ktor: query params opcionales.** `parameter("mine", true)` y `parameter("kind", valor)` **solo cuando aplican**; si mandás `kind=""` el backend filtra por la cadena vacía y devuelve nada. Por eso el caso de `kind` en blanco se normaliza a `null` en el caso de uso, no en el adaptador.
6. **`expectSuccess = false` otra vez.** Si Ktor lanza en los 4xx, se pierde el `message` del backend (`{"message":"Unauthorized","statusCode":401}`) que es justo lo que la pantalla necesita mostrar.
7. **Portadas: Coil 3 y un loader único.** Compose Multiplatform no trae cargador de imágenes de red. `coil-compose` + `coil-network-ktor3` resuelven Android y Desktop con el mismo código, y el fetcher se registra una vez con `setSingletonImageLoaderFactory` en la raíz. El placeholder tipográfico se pinta **debajo** del `AsyncImage`, así una portada lenta o rota nunca deja un hueco blanco.
8. **El estado de error no borra lo que ya se ve.** `LibraryViewModel` deja `books` intacto cuando falla; si no, un refresh con la red caída vaciaría la pantalla y el usuario perdería el contexto.

## Pendiente

- **Verificación visual con sesión real**: la app necesita login para llegar a Biblioteca, y las credenciales son del usuario. Lo que sí está probado sin credenciales: el catálogo público responde `200` con 24 libros, el parser los mapea (payload real en test), y `?mine=true` sin sesión devuelve `401 {"message":"Unauthorized"}`.
- **Paginación**: hoy se piden los libros sin `limit`/`offset`. Con 24 libros alcanza; cuando el catálogo crezca hay que paginar o el arranque se va a sentir pesado.
- **`roomId`** queda como campo muerto en `Book`: la web usa `kind` como estante. Conviene borrarlo cuando alguien toque el dominio.
- **`SharedPreferencesStore`/`KeystoreAuthSession`** siguen sin test de instrumentación (solo compilación); es el techo conocido de los adaptadores Android.
