# Lectura demo sin cuenta + rotación de destacado + sin APK

Producto combinado: cerrar la lectura anónima salvo un libro demo destacado que rota, sin guardar nada para el anónimo, y sacar la descarga de la APK de la landing (queda la PWA).

## Specs

- S1 (T1): «hoy se puede leer sin crear cuenta y eso esta mal» → sin sesión, `GET /books/:id/reading` y el SSR de `/lecturas/:id` solo permiten el libro demo destacado; cualquier otro libro exige sesión.
- S2 (T1, T2): «no se tienen que guardar ningun cambio que hagan es solamente para mostrar el producto» → el anónimo leyendo el libro demo no persiste nada: sin métricas (`read_started` incluido), sin progreso al backend, sin snapshot local ni anotaciones.
- S3 (T1, T2): «las demas lecturas quedan bloqueadas hasta que se logeen» → sin sesión + libro que no es el demo → redirect a `/login` con `next=`.
- S4 (T1, T3): «el 404 es porque se eligio un libro que se borro (deberia ir rotandose)» → el destacado/embed se elige rotando entre los libros publicados vivos, con la misma regla en backend y landing; si el catálogo queda vacío, la landing degrada con gracia en vez de apuntar a un libro muerto.
- S5 (T3): «saquemos por el momento el descargar la apk. y dejemos la pwa por el momento» → fuera la CTA/link de `/apps/ignit-1.0.0.apk` en la landing; la PWA se mantiene.

## Tasks

- T1 [S1, S2, S4] · backend · selección determinista del libro demo destacado (rotación por hora entre publicados), anónimo solo con `GET /books/demo-featured`, `GET /books/:id/reading` anónimo solo si `id === demoId`, métricas anónimas bloqueadas · commit: 60b2fda
- T2 [S1, S2, S3] · web · SSR de `/lecturas/[id]`: sin sesión y no-demo → redirect `/login?redirect=`; demo sin sesión → `canSync=false`, sin métricas ni snapshot local ni anotaciones · commit: da6cc72
- T3 [S4, S5] · landing · destacado/embed usan la rotación (misma regla que backend), fallback sin catálogo, se quita la CTA de APK y se ajusta el copy «Leer sin cuenta» · commit: 82485a7

## Log

- L1 (usuario, verbatim): «Vamos a revisar lo siguiente: 1- hoy se puede leer sin crear cuenta y eso esta mal 2- lo que deberia quedar pero no guardarse ningun cambio es en [imagen 404] porque sino va a ser un quilombo si todos tocan.»
- L2 (usuario): «el 404 es porque se eligio un libro que se borro (deberia ir rotandose)»
- L3 (usuario): «1- Estan bien los dos puntos pero no se tienen que guardar ningun cambio que hagan es solamente para mostrar el producto. 2- las demas lecturas quedan bloqueadas hasta que se logeen. 3- saquemos por el momento el descargar la apk. y dejemos la pwa por el momento.»
- L4 (decisión): demo anónima = únicamente el libro destacado que rota (el de la landing); sin sesión + otro libro → login. Nada persistido para el anónimo, incluido localStorage.
- L5 (verificación): backend 45/45 archivos (380 tests, incl. demo-featured.spec 9) + build OK; web 50/50 archivos (334 tests) + astro check 0 errores + build OK. En vivo (backend dev sqlite): `/books/demo-featured` → `{id:49}` 200; `/books/50/reading` anónimo → 401 español; `/books/49/reading` anónimo → 200; metric anónimo → 401. SSR smoke sin backend: `/lecturas/7` y `/biblioteca` → 302 `/login?redirect=...`, `/` → 200 (fail-closed). Verificación diferencial del copy: única salida conocida de «Leer sin cuenta» (hero) y la CTA de APK removidas en 82485a7.

## Risk

- T1: riesgo alto item 3 — `GET /books/:id/reading` es un contrato público que hoy consumen lectores anónimos; el gate reduce ese contrato deliberadamente (pedido explícito del usuario S1/S3), con escape demo rotante. Verificado: suite + e2e en vivo.
- T2/T3: riesgo bajo; copy y embed verificados con suites y build.
