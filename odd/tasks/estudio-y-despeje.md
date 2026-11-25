# Estudio y Despeje — Landing 04 + Biblioteca 05

Implementar en el stack real (Astro + Solid, `web/`) las dos artboards registradas en
`design/biblioteca-tecnico-literatura/design.json` bajo esa dirección visual, usando
tokens de `design/system.md` (noche-azul por defecto + puente `--b-*` en interiores).
No copiar el HTML de las artboards: mapear a componentes y estilos existentes.

## Specs

- S1 — Implementar la artboard `design/biblioteca-tecnico-literatura/04-landing-estudio-y-despeje.html` («Landing — Estudio y Despeje») en la landing real (`web/src/pages/index.astro`, `web/src/features/landing/**`, layout `LandingLayout.astro`). Hero «El lugar tranquilo para leer y estudiar» con las dos salas (Estudio Profesional / Despeje Literario), sección «Elegí tu estancia de lectura» con las dos salas-catalogo, fila de chips de disciplinas y estante con tomos numerados.
- S2 — Implementar la artboard `design/biblioteca-tecnico-literatura/05-biblioteca-estudio-despeje.html` («Mi Biblioteca — Estudio Profesional y Despeje») en `web/src/pages/biblioteca.astro`, `web/src/features/library/**` y `BibliotecaLayout.astro`: dos paneles montados (Estudio Profesional 7 tomos / Despeje Literario 6 tomos) con chips de disciplina, fila de sync/offline + resumen, y rejilla de fichas numeradas (01/02/…, dominio + años, LEER/AÑADIR).
- S3 — No regresar comportamiento existente: tabs del topbar (device/library/catalog/submissions), toggle offline (real y de prueba), descarga/quite PWA, refresh de listas, modales (ficha, editar, subir), búsqueda y filtros del catálogo, aportes, aria-live, y continuidad de lectura siguen funcionando igual con la nueva piel.
- S4 — Tokens y tipografías desde `design/system.md` exclusivamente (surfaces `--b-*` con interior contrast lift, mono para metadatos, serif Shippori/Georgia para títulos editoriales, `--aka` azul para sellos); colores exactos de las dos paletas ya declaradas en `global.css` (light warm / `.dark` / `[data-palette="noche-azul"]`); nada de valores inventados.
- S5 — Responsive acorde a las artboards (grilla colapsa a una columna, fichas apiladas) y `prefers-reduced-motion` respetado; textos en español rioplatense como el resto del app.

## Tasks

- T1 → S1, S4, S5, S3 — Landing (04): landing.css + HeroSection + secciones de landing. Route: worker (gentle-ai-worker). Commit: 47977dc.
- T2 → S2, S4, S5, S3 — Biblioteca (05): biblioteca.css + BibliotecaApp/HeroDash/SalaTopbar/BookTomoCard. Route: worker (gentle-ai-worker). Commit: 48b0f5a.

## Log

- Slice 1: commits 47977dc + 48b0f5a (456 + 6445 líneas, medición del lock del harness sobre origin/main; incluye el feature doc). Conventional Commits por unidad en feat/estudio-y-despeje.

- L1 (verbatim, primera petición): «Sigamos con el diseño de @"design/biblioteca-tecnico-literatura/01-dos-alas-  arquitectonicas.html" antes de hacerlo prende el servidor asi puedo ver el diseño exacto»
- L2 (verbatim): «no es este. el cambio es de la landing @design/biblioteca-tecnico-literatura/04-landing-estudio-y-despeje.html prende ese»
- L3 (verbatim): «bien, agreguemos estos diseño el diseño: [Image#1] y [Image#2]» — las imágenes son las artboards 04 (Landing — Estudio y Despeje) y 05 (Mi Biblioteca — Estudio Profesional y Despeje) del canvas.
- L4 (evidencia): T1 worker — RED 4 failed (helpers faltantes) → GREEN 17 passed; vitest 36/36, astro check 0 errores, build OK. Commit 47977dc. Desviación declarada: 4 chips de disciplina de la artboard (derecho/medicina/economía/diseño) no existen en BookKind; fila armada con los 8 kinds reales.
- L5 (evidencia): T2 worker — RED 12 failed → GREEN 35/35 en suite library; suite completa 319/319, astro check 0 errores, build OK. Commit 48b0f5a. Paneles arrancan sin sala activa para no alterar el comportamiento por defecto (S3); metadata muestra páginas+tamaño reales (no hay campo de año en Book).
- L6 (slice): Slice 1 de unidad = commits 47977dc (landing) + 48b0f5a (biblioteca + design artboards + feature doc) en branch feat/estudio-y-despeje.
- L7 (verbatim): «que llegue a prod» + «Dale agreguemos esas dos desviaciones y explicame lo de la sala activa» — decisión 1: default «Estudio y Disciplina» activo (estadoInicial `estudio`, BibliotecaApp.tsx:132, sin test de app-level disponible; pin a nivel panelynch sigue valiendo). Decisión 2: agregar kinds `derecho/medicina/economia/diseno` (T3) — cambio de taxonomía compartida. Decisión 3: entrega a prod (push + merge a main + deploy wrangler desde checkout limpio, nunca desde el worktree con WIP ajeno de auth).
- L8 (evidencia T3, inline): RED types.test.ts 2 failed (kinds nuevos no aceptados) → GREEN 59/59 (entities+landing+library) tras extender types.ts, book-kind.enum.ts backend, SALA_KINDS y SALA_ESTADO_KINDS; pins actualizados, no borrados. Astro check 0 errores. Backend suite src/books 255/255 verde (DTOs usan IsEnum(BookKind), columna varchar(20) + enum app-level — sin migración). El filtro GET /books?kind=derecho queda soportado por el mismo enum.
