# Fase 2 — Biblioteca básica

Estado: implementado en la rama `feat/app-native-fase-1-login`. La biblioteca consume el catálogo real de producción (`GET /api/books`) y reemplaza el placeholder de Fase 1.

## Qué quedó armado

### Dominio y puertos

- `Book` ahora refleja el catálogo real: `author`, `kind`, `coverUrl` (nullable) y `published`, además de `id`, `title`. `totalPages` se alimenta del campo `filePages` que sí manda la API; `roomId` no tiene contraparte en el backend y queda como campo local.
- `LibraryRepository.fetchLibrary(mine, kind, limit = 12, offset = 0): BookPage` y `SyncLibrary(...)` separan catálogo público de biblioteca personal, filtran por estante y **pagina**. `BookPage(items, total, offset, limit)` trae `hasMore` calculado, así la UI no adivina si quedan páginas.
- **`UserSession` ganó `sessionCookie`**: el par `nombre=valor` completo de la cookie de sesión. Es la credencial que el backend acepta (ver Aprendizaje 1).

### Adaptadores

- `KtorLibraryRepository` llama `GET {baseUrl}/api/books` con `?mine=true` y `?kind=` solo cuando corresponden, manda `Cookie` desde `AuthSession`, y acepta **array pelado o envelope `{ items, … }`** (el backend devuelve array si no se mandan `offset`/`limit`). Un objeto sin array `items` —o un root que no sea array ni objeto— **falla con `AuthException`** en vez de devolver una biblioteca vacía: un 200 con `{"message":"boom"}` no es "no hay libros".
- `KtorAuthGateway` guarda **ambas** credenciales: el `token` del body y el par `nombre=valor` de la cookie de sesión (con prefijo `__Secure-` cuando viene así). Cuál de las dos vale depende del modo del backend —ver Aprendizaje 1—, así que no se descarta ninguna.
- `SessionCodec` persiste `sessionCookie` y **sigue decodificando sesiones viejas** sin ese campo: si hubiera devuelto `null`, cada instalación existente habría quedado deslogueada.

### UI

- `LibraryViewModel`: `scope` (catálogo / mi biblioteca), `kind`, `books`, `loading`, `error`; `load` no reentra y no se traga `CancellationException`. Una falla **no borra** los libros ya cargados.
- `LibraryScreen`: header con usuario y cerrar sesión, selector de alcance, **desplegable colapsable de categorías**, grilla `LazyVerticalGrid` de tarjetas 2:3 con portada Coil y placeholder tipográfico, **scroll infinito por páginas** con indicador de "cargando más", estados loading/error/vacío, y "Actualizar".
- La lista de categorías **se deriva del catálogo sin filtrar** y crece de forma monótona: nunca se reduce a la categoría elegida.

## Tests

| Módulo | Test | Qué fija |
| --- | --- | --- |
| `core:application` | `SyncLibraryTest` | `(mine, kind)` por defecto, forwarding, `kind` en blanco → `null`, fallo → `Result.failure`. |
| `adapters:driven:http-api` | `KtorLibraryRepositoryTest` | query string, `Cookie` solo si hay sesión, array y envelope, `401` con mensaje del backend, fallo de transporte. |
| `adapters:driven:http-api` | `KtorLibraryRepositoryProductionPayloadTest` | El **payload real de producción** (dos libros capturados): `id` numérico, `filePages`, `coverUrl` nullable, campos ignorados. |
| `adapters:driven:http-api` | `KtorAuthGatewayTest` | La cookie firmada se guarda como credencial; el token del body sigue sirviendo de fallback. |
| `adapters:driven:auth-session` | `SessionCodecTest` | Round-trip con `sessionCookie` y **compatibilidad con payloads viejos**. |
| `adapters:driving:ui-compose` | `LibraryViewModelTest` | alcance/estante/`limit`/`offset` hacia el puerto, paginado que apila y deduplica por `id`, error que conserva los libros, supersesión de un `loadMore` viejo, **categorías que no se reducen al filtrar**, `kindLabel`. |

## Aprendizaje

1. **Cuál credencial vale depende del MODO del backend, y hay que leerlo antes de asumir.** Me equivoqué acá y costó caro. Lo primero que miré fue `backend/src/auth/auth.ts` + `better-session.reader.ts` (better-auth, cookie) y concluí que la cookie firmada era la credencial. Pero producción responde `GET /api/session-mode` → `{"mode":"neon","guarded":true}`, y en ese modo el guard (`neon-session.reader.ts`) lee **sólo** `Authorization: Bearer <JWT>` y lo verifica con `jwtVerify` (EdDSA contra el JWKS de Neon): las cookies no las mira. Mientras tanto `/api/auth/*` sí está proxeado a better-auth, que devuelve un token opaco — que no es un JWT de Neon.
2. **Consecuencia medible: la biblioteca personal no puede autenticarse en producción hoy.** Probado desde el host con el token real del sign-in: `?mine=true` responde `401` sin credencial, con `Authorization: Bearer <token>`, y con las dos variantes de cookie. No es un bug de mobile: es un hueco del backend (el endpoint de login emite una credencial que el guard de la API no acepta). La app hace lo único honesto que puede: manda lo que tiene —`Bearer` si hay token, `Cookie` si hay cookie— y deja que la API conteste. Arreglarlo requiere decidir del lado del servidor.
3. **La regla práctica:** el cliente no puede adivinar en qué modo corre el servidor, así que `UserSession` guarda token **y** cookie, y los adaptadores emiten ambos headers cuando existen. Cualquier "sólo cookie" o "sólo bearer" es frágil por diseño.
4. **Un endpoint puede devolver dos formas.** El controller responde un array pelado, y un envelope `{ items, total, offset, limit }` cuando el cliente manda `offset`/`limit`. El parser acepta ambas en vez de asumir: es más barato que descubrirlo cuando la fase 3 pagine.
5. **La forma real del payload se verifica con `curl`, no con la imaginación.** Dos supuestos del plan cayeron contra producción: (a) los `kind` reales son `tecnico`, `terror_scifi`, `filosofia`, `ficcion`, `poesia` —no existe `no_tecnico`—, así que los chips fijos habrían mostrado estantes vacíos; (b) el total de páginas viaja como `filePages`, no `totalPages`, así que todos los libros marcaban 0. Ambos se corrigieron y quedaron fijados con un test que usa el payload real capturado.
6. **Los filtros de UI se derivan de los datos, no del enum que uno supone.** Si mañana alguien agrega el estante `ensayo`, la app lo muestra sin recompilar. El label se resuelve con un mapa conocido + humanizado genérico (`novela_negra` → "Novela negra").
7. **Ktor: query params opcionales.** `parameter("mine", true)` y `parameter("kind", valor)` **solo cuando aplican**; si mandás `kind=""` el backend filtra por la cadena vacía y devuelve nada. Por eso el caso de `kind` en blanco se normaliza a `null` en el caso de uso, no en el adaptador.
8. **`expectSuccess = false` otra vez.** Si Ktor lanza en los 4xx, se pierde el `message` del backend (`{"message":"Unauthorized","statusCode":401}`) que es justo lo que la pantalla necesita mostrar.
9. **Portadas: Coil 3 y un loader único.** Compose Multiplatform no trae cargador de imágenes de red. `coil-compose` + `coil-network-ktor3` resuelven Android y Desktop con el mismo código, y el fetcher se registra una vez con `setSingletonImageLoaderFactory` en la raíz. El placeholder tipográfico se pinta **debajo** del `AsyncImage`, así una portada lenta o rota nunca deja un hueco blanco.
10. **Derivar las opciones de un filtro desde los datos ya filtrados es un error de diseño.** Fue exactamente el bug que reportó el usuario: `availableKinds` salía de `books` después de aplicar el filtro, así que al elegir "Técnico" la única categoría conocida pasaba a ser "Técnico" y el resto desaparecía. La lista de opciones tiene que venir de una fuente **independiente del filtro** (el catálogo sin filtrar) y crecer de forma monótona. Es la regla general: las opciones de un control no pueden depender de la selección de ese control.
11. **Paginación: `limit`/`offset` cambian la forma de la respuesta.** Sin esos parámetros el backend devuelve un array pelado; con ellos, un envelope `{items,total,offset,limit}`. Medido: 24 libros, página 1 → 12 items con `total:24`, página 2 → los otros 12. El adaptador acepta ambas formas y sintetiza `total` cuando no hay envelope, pero la UI siempre pide páginas.
12. **Deduplicar al apilar páginas no es paranoia.** Entre dos requests el catálogo puede cambiar y repetir un libro; una clave duplicada revienta `LazyVerticalGrid`. El view model deduplica por `Book.id`.
13. **Descartar un pedido porque ya hay otro en vuelo es un bug, no una optimización.** `if (loading) return` parecía prudente y era peor: tocar "Mi biblioteca" mientras cargaba el catálogo dejaba la pestaña en Mi biblioteca y la grilla con el catálogo público. Ahora cada pedido toma una generación y **gana el último**: el que quedó viejo no escribe `books`, ni `error`, ni `loading`.
14. **Una sesión sin credencial no es una sesión.** `LogIn` rechaza y no persiste una respuesta sin cookie firmada, y `GetCurrentSession` descarta la que ya no la tenga. Preferible un login que falla con un mensaje que una app "logueada" que responde `Unauthorized` y al reiniciar te desloguea sin explicación.
15. **El estado de error no borra lo que ya se ve.** `LibraryViewModel` deja `books` intacto cuando falla; si no, un refresh con la red caída vaciaría la pantalla y el usuario perdería el contexto.

## Pendiente

- **Verificación visual con sesión real**: la app necesita login para llegar a Biblioteca, y las credenciales son del usuario. Lo que sí está probado sin credenciales: el catálogo público responde `200` con 24 libros, el parser los mapea (payload real en test), y `?mine=true` sin sesión devuelve `401 {"message":"Unauthorized"}`.
- **Paginación**: hecha con `limit=12`. El scroll infinito se dispara al llegar al último ítem visible; si falla una página, los libros ya cargados quedan y el footer ofrece reintentar.
- **El toggle de paleta se ve raro** (reportado por el usuario, aceptado como deuda para no bloquear la fase). Vive como overlay `TopEnd` con `padding(16.dp)` **dentro** del contenido de la app, no del sistema, así que compite con la barra de estado y con el header de la biblioteca — de ahí el `padding` superior de 56.dp que se le agregó a `LibraryScreen` como parche. Lo correcto es sacarlo del overlay: un slot en el header de cada pantalla y `statusBarsPadding()` para respetar los insets.
- **`roomId`** queda como campo muerto en `Book`: la web usa `kind` como estante. Conviene borrarlo cuando alguien toque el dominio.
- **`SharedPreferencesStore`/`KeystoreAuthSession`** siguen sin test de instrumentación (solo compilación); es el techo conocido de los adaptadores Android.
