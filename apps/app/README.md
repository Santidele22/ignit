# Ignit app nativa — Kotlin/Compose Multiplatform

App nativa móvil (Android) con arquitectura **hexagonal (puertos y adaptadores)**. La aplicación de escritorio oficial pasó a `apps/desktop/` (Tauri v2 reutilizando `web/`).
Issue de origen: [Santidele22/ignit#2](https://github.com/Santidele22/ignit/issues/2).

## Dependencia del hexágono (regla de las flechas)

```
platforms/ ──▶ adapters/ ──▶ core/ ──▶ (nada: Kotlin puro)
   (entry        (driving/driven      (dominio y casos de uso,
    points)       implementan          sin dependencias de
                  los puertos)         framework ni HTTP)
```

- `core/domain`: conocimiento del negocio. Nada de Ktor, Room, ni Compose.
- `core/application`: casos de uso y **puertos** (interfaces para la I/O que necesita).
- `adapters/driven`: implementan los puertos de salida (`http-api`, `persistence`, `auth-session`).
- `adapters/driving/ui-compose`: Compose UI + view models que **llaman casos de uso** (nunca HTTP directo).
- `platforms/android`: entry point Android; solo wiring, splash, navegación raíz. (`core/` conserva el target `jvm()` para correr tests rápidos sin Android SDK.)

Regla dura: una dependencia que apunte hacia adentro está bien; cualquier `import` de infraestructura dentro de `core/` es un defecto de arquitectura (se valida en code review del módulo).

## Módulos

| Módulo | Tipo | Contenido esperado |
| --- | --- | --- |
| `core/domain` | KMP (Kotlin puro) | Entidades (`Book`, `ReadingProgress`, `User`, `Chapter`), value objects, reglas |
| `core/application` | KMP (Kotlin puro) | Casos de uso (`SyncLibrary`, `DownloadChapter`, `SaveProgress`…), puertos out |
| `adapters/driven/http-api` | KMP | Cliente Ktor contra la API actual (Render) |
| `adapters/driven/persistence` | KMP | SQLDelight/Room: libros offline y progreso local |
| `adapters/driven/auth-session` | KMP | Sesión/secure storage |
| `adapters/driving/ui-compose` | KMP | Pantallas Compose compartidas + estados |
| `platforms/android` | app | Compose Android (APK/AAB firmada) |

## Estado

Estructura creada; setup de Gradle (version catalog, plugins KMP, firma) y primer build pendientes — ver issue #2.
