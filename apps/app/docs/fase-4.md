# Fase 4 — Offline y sync real (SQLite + IGB1 + Outbox LWW)

## Qué se construyó
- **Resolución de conflictos LWW**: `resolveProgressConflict(local, remote)` en `core/domain`.
- **Casos de uso offline**: `DownloadBookOffline`, `RemoveOfflineBook` e `IsBookAvailableOffline` en `core/application`.
- **Persistencia & Sync**: `IgnitLocalDatabase.kt`, `AndroidSqliteLocalStore.kt`, `LocalProgressRepository.kt` y `DeltaSyncCoordinator.kt` en `adapters/driven/persistence`, almacenando libros en formato comprimido `IGB1` y encolando cambios de progreso en `sync_outbox` para reintento al recuperar conectividad.

## Aprendizaje
- Guardar el libro completo como `.igb` en lugar de JSON plano reduce ~80–90% el uso de almacenamiento del dispositivo y permite compartir exactamente el mismo formato encriptado entre Desktop y Android.
- La cola `sync_outbox` desacopla la lectura offline de la red: avanzar páginas nunca se bloquea esperando al servidor.
