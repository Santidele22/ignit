# Ignit Desktop (Tauri v2)

Aplicación de escritorio oficial de **Ignit** construida con Tauri v2 (Rust + WebView nativo) sobre la aplicación web SSR (`web/`).

## URLs objetivo

- **Desarrollo (`debug`)**: `http://localhost:4321/biblioteca`
- **Producción (`release`)**: `https://ignit.ignit677.workers.dev/biblioteca`
- **Override opcional**: variable de entorno `IGNIT_DESKTOP_URL`

## Desarrollo local

1. Levantar `backend/` y `web/` (por ejemplo `./scripts/dev.sh --no-docker` desde la raíz).
2. Ejecutar la app desktop en modo desarrollo:
   ```bash
   cd apps/desktop/src-tauri
   cargo tauri dev
   ```

## Tests y checks

```bash
cd apps/desktop/src-tauri
cargo test && cargo check
```

## Build de instaladores

```bash
cd apps/desktop/src-tauri
cargo tauri build
```

Los artefactos generados quedan en `apps/desktop/src-tauri/target/release/bundle/`.
