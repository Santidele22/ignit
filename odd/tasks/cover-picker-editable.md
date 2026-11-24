# Cover picker editable (portadas de libros viejos)

Feature: editar libros antiguos para elegir la portada real con opciones, reusando un CoverPickerModal compartido; pinear los hallazgos del verificador con tests.

## Specs
- S1: «deberiamos poder editar los antiguos para que puedan elegir la portada real con opciones» — `web/src/features/book/components/CoverPickerModal.tsx` es el único diálogo compartido de portadas de Google Books usado por `UploadBookModal` y `EditBookModal` (click en tarjeta selecciona y cierra; «Usar tapa editorial» limpia vía `onSelect('')`).
- S2: abrir el picker auto-ejecuta exactamente una query `searchBookCovers` sembrada con el texto del padre; una query distinta tipeada sobrevive un RTT de búsqueda (el fix `untrack` eliminó el loop infinito: `createEffect` → guard de `runSearch` leía `searching()` reactivamente → re-ejecución por settle). Test de regresión: búsqueda llamada exactamente una vez a través de settles.
- S3: click en tarjeta resultado llama `onSelect(item.coverUrl)` Y `onClose()` — un click, ambos callbacks.
- S4: con el picker abierto, `Escape` dentro no cierra el modal padre, solo la capa picker (guard `coverModalOpen` en `close()` de ambos modales).
- S5: «Bueno arreglemos esos hallazgos. (delega a gentle-worker)» — pinear con tests de componente los hallazgos del verificador (loop untrack, click-cierra, Escape), infra de test acotada en `web/` sin alterar la suite existente.

## Tasks
- T1 (S1-S4) inline, hecho: extracción de `CoverPickerModal`, integración en ambos modales, contrato `coverUrl` en `bookFormToBody`, fixes del verificador (untrack, click-cierra, onResults) — commits pendientes.
- T2 (S5) worker, commit sí: tests de componente `CoverPickerModal.test.tsx`, `vitest.config.ts` acotada, deps de test si hacen falta.
- T3 (T1+T2) parent: verificación final (pnpm test/build/astro check) y commit de unidad.

## Log
- L1: «vamos a arreglar el tema de las portadas; 1- como agregamos la nueva feature con el llm para agregar desc, y agregar las portadas del libro deberiamos poder editar los antiguos para que puedan elegir la portada real con opciones.»
- L2: «continua» — autoriza ejecutar lo propuesto.
- L3: verificador `gentle-ai-verify` (task mwv0qwvj-1-i6po): 1 bloqueante (loop de búsqueda en CoverPickerModal por `searching()` trackeado en el effect; probe Solid: 1601 runs / 1200 searches en 150 ms), 2 regresiones (click ya no cerraba; auto-select de primera portada perdido en apertura manual), 1 hallazgo de alcance (tercer caller `BooksEditorPanel.tsx`). Todos corregidos inline; web 260/260, build ok, astro check 0 errores.
- L4: «Bueno arreglemos esos hallazgos. (delega a gentle-worker)» — delegar pineo de hallazgos; el primer intento de writer fue rechazado (unidad pequeña sin doc ODD); el usuario eligió «Trackear como ODD», se crea este documento.
- L5: worker T2 completado (task mwv19qyq-2-0nun): `CoverPickerModal.test.tsx` con 7 tests (S2 RED/GREEN verificado quitando untrack: fallo "called 1 times, but got 2 times"), infra `happy-dom@21` + `vite-plugin-solid@2.11` + `@solidjs/testing-library@0.8` y `vitest.config.ts` con entorno node global; suite 40/260 → 41/267; `pnpm build` exit 0; `astro check` 0 errores. S4 parcial documentado (guard del padre leído read-only). Nota: `pnpm-lock.yaml` quedó modificado fuera de las surfaces (auto-sync de pnpm al correr test/build); decisión del padre: incluirlo en el commit de unidad.
- L6: verificación del padre (T3): web 41/267 verde, build ok, astro check 0 errores/0 warnings/1 hint preexistente (contentCache.ts:109), componente re-verificado byte a byte tras el RED probe (`untrack` intacto en líneas 1/38/40/49).- L7: commits de unidad en rama `feat/cover-picker-editable` — `52b14c1` feat(web) (feature, 6 archivos) y `2799d0a` test(web) (infra+tests, 4 archivos); slice total 639 líneas cambiadas, sobre la guía de ~400 por slice: al publicar, separar los dos commits como slices de review (chained PR) si prefiere no llevarlos juntos.
- L8: RDD assess del candidato (base d62e182): nativeRisk medium (configuration_change en web/package.json), reviewDue false (under_budget) → sin review nativa pendiente; la auto-verificación del writer queda como evidencia (RED/GREEN en S2 + suite completa).
