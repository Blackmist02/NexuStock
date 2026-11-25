| Requisito | Casos | Aprobados | Observación | Fallidos |
| CU-01 | 6 | 6 | 0 | 0 |
| CU-02 | 4 | 4 | 0 | 0 |
| CU-03 | 2 | 2 | 0 | 0 |
| CU-04 | 12 | 11 | 0 | 1 |
| CU-05 | 7 | 7 | 0 | 0 |
| CU-06 | 7 | 7 | 0 | 0 |
| CU-07 | 10 | 9 | 1 | 0 |
| CU-08 | 3 | 3 | 0 | 0 |
| CU-09 | 5 | 5 | 0 | 0 |
| CU-10 | 2 | 2 | 0 | 0 |
| CU-11 | 3 | 3 | 0 | 0 |
| CU-12 | 7 | 7 | 0 | 0 |
| CU-13 | 8 | 8 | 0 | 0 |
| RNF-03 / RNF-12 | 1 | 0 | 0 | 1 |
| RNF-05 | 1 | 1 | 0 | 0 |
| RNF-06 | 7 | 7 | 0 | 0 |
| RNF-07 | 2 | 2 | 0 | 0 |
| RNF-08 | 1 | 1 | 0 | 0 |
| RNF-09 | 1 | 0 | 0 | 1 |
| RNF-17 | 2 | 2 | 0 | 0 |
| RNF-19 | 2 | 2 | 0 | 0 |

| ID | Req. | Caso | Resultado esperado | Obtenido | Resultado |
|---|---|---|---|---|---|
| INF-01 | RNF-19 | Health check de la API con la base de datos | 200, status OK y database OK | HTTP 200 en 624 ms, database=OK | Aprobado |
| INF-02 | RNF-17 | Frontend publicado responde | 200 en /login | HTTP 200 en 546 ms | Aprobado |
| INF-03 | RNF-17 | El frontend reenvía /api/* a la API (mismo origen) | 200 con database OK | HTTP 200 en 342 ms | Aprobado |
| SEG-01 | RNF-06 | HTTP redirige a HTTPS (nexustock-api.onrender.com) | 301/302/307/308 hacia https:// | HTTP 301 → https://nexustock-api.onrender.com/api/health | Aprobado |
| SEG-02 | RNF-06 | HTTP redirige a HTTPS (nexustock-omega.vercel.app) | 301/302/307/308 hacia https:// | HTTP 308 → https://nexustock-omega.vercel.app/api/health | Aprobado |
| SEG-03 | RNF-06 | Cabecera HSTS en API y frontend | Strict-Transport-Security presente en ambos | API: max-age=31536000; includeSubDomains | Front: max-age=63072000; includeSubDomains; preload | Aprobado |
| SEG-04 | RNF-06 | La API no anuncia la tecnología del servidor | Sin X-Powered-By; con X-Content-Type-Options | x-powered-by=ausente, nosniff=nosniff | Aprobado |
| SEG-05 | RNF-06 | CORS rechaza un origen no autorizado | 403 origen_no_permitido, sin Access-Control-Allow-Origin | HTTP 403 origen_no_permitido en 223 ms | Aprobado |
| SEG-06 | RNF-06 | CORS acepta el origen del frontend | 200 con Access-Control-Allow-Origin = frontend | HTTP 200 en 231 ms, ACAO=https://nexustock-omega.vercel.app | Aprobado |
| CU07-01 | CU-07 | Inicio de sesión con credenciales válidas (admin QA) | 200, rol administrador y cookie de sesión | HTTP 200 en 2225 ms | Aprobado |
| SEG-07 | RNF-05 | Cookie de sesión protegida | HttpOnly, Secure y SameSite=Lax | nx_token=…; Path=/; HttpOnly; Secure; SameSite=Lax | Aprobado |
| CU07-02 | CU-07 | Credenciales inválidas: mensaje genérico (4a) | 401 con el mismo mensaje para clave errónea y correo inexistente | HTTP 401 no_autenticado en 2606 ms / HTTP 401 no_autenticado en 2917 ms — «Correo o contraseña incorrectos» | Aprobado |
| CU07-03 | CU-07 | Operación sin sesión | 401 | HTTP 401 no_autenticado en 235 ms | Aprobado |
| CU07-04 | CU-07 | Token sin firma (alg none) rechazado (7a) | 401 | HTTP 401 no_autenticado en 228 ms | Aprobado |
| SEG-08 | RNF-06 | CSRF: modificación con cookie pero sin cabecera x-nx-csrf | 403 y no se crea el registro | HTTP 403 prohibido en 216 ms | Aprobado |
| CU12-01 | CU-12 | Registro público cerrado con administrador existente | necesitaRegistro=false y registroAbierto=false | {"necesitaRegistro":false,"registroAbierto":false} | Aprobado |
| CU12-02 | CU-12 | Alta inicial cuando ya hay administrador (2a) | 403 indicando pedir la cuenta al administrador | HTTP 403 prohibido en 2568 ms — «El registro está cerrado. Pide a un administrador que cree tu usuario.» | Aprobado |
| CU12-03 | CU-12 | Administrador crea un operador | 201, activo y rol operador | HTTP 201 en 2909 ms | Aprobado |
| CU12-04 | CU-12 | Administrador crea un usuario TI | 201 y rol ti | HTTP 201 en 2285 ms | Aprobado |
| CU12-05 | CU-12 | Correo ya registrado (4a) | 4xx informado junto al campo email | HTTP 400 validacion en 2513 ms — «Ese correo ya está registrado» | Aprobado |
| CU12-06 | CU-12 | Contraseña fuera de política (4b) | 400 con el detalle del campo password | HTTP 400 validacion en 241 ms | Aprobado |
| CU07-05 | CU-07 | Inicio de sesión de operador y TI recién creados | 200 en ambos | HTTP 200 en 2349 ms / HTTP 200 en 2302 ms | Aprobado |
| CU12-07 | CU-12 | Operador intenta crear cuentas (1a) | 403 | HTTP 403 prohibido en 229 ms | Aprobado |
| CU07-06 | CU-07 | Rol sin permiso: operador en el panel técnico (7b) | 403 con mensaje claro | HTTP 403 prohibido en 221 ms — «Tu rol no tiene permiso para esta acción» | Aprobado |
| CU04-01 | CU-04 | Crear categoría | 201 | HTTP 201 en 263 ms | Aprobado |
| CU04-02 | CU-04 | Nombre de categoría duplicado (6a) | 4xx informado junto al campo nombre | HTTP 400 validacion en 226 ms — «Ya existe una categoría con ese nombre» | Aprobado |
| CU04-03 | CU-04 | Lead time negativo o sin días hábiles (6b) | 400 en ambos casos | HTTP 400 validacion en 218 ms / HTTP 400 validacion en 238 ms | Aprobado |
| CU04-04 | CU-04 | Crear proveedor | 201 | HTTP 201 en 551 ms | Aprobado |
| CU04-05 | CU-04 | Baja lógica de proveedor sin productos | 200 y activo=false | HTTP 200 en 255 ms | Aprobado |
| CU04-06 | CU-04 | Crear producto con stock inicial | 201 y stock 10 kg | HTTP 201 en 386 ms | Aprobado |
| CU04-07 | CU-04 | Crear producto nuevo sin historial en categoría con datos (Cerdo) | 201 | HTTP 201 en 336 ms | Aprobado |
| CU04-08 | CU-04 | Producto con identificador de categoría fuera de rango (6) | 400 junto al campo id_categoria | HTTP 500 error_interno en 230 ms — «Error interno del servidor» | Fallido |
| CU04-12 | CU-04 | Producto con categoría inexistente (6) | 400 junto al campo id_categoria | HTTP 400 validacion en 243 ms — «La categoría no existe» | Aprobado |
| CU04-09 | CU-04 | Editar precio del producto | 200 y precio 10.490 | HTTP 200 en 667 ms | Aprobado |
| CU04-10 | CU-04 | Operador intenta modificar el catálogo | 403 | HTTP 403 prohibido en 215 ms | Aprobado |
| CU02-01 | CU-02 | Operador registra recepción de 20 kg | 201, stock 10→30 y costo total 100.000 | HTTP 201 en 321 ms, stock 10→30, total 100000 | Aprobado |
| CU02-02 | CU-02 | Cantidad cero (4a) | 400 y no se registra | HTTP 400 validacion en 226 ms | Aprobado |
| CU02-03 | CU-02 | Proveedor inactivo (4b) | 400 junto al campo id_proveedor | HTTP 400 validacion en 238 ms | Aprobado |
| CU02-04 | CU-02 | Rol TI no registra compras (1a) | 403 | HTTP 403 prohibido en 222 ms | Aprobado |
| CU01-01 | CU-01 | Operador vende 3 kg con precio del catálogo | 201, total 3 × 10.490 = 31.470 y stock 30→27 | HTTP 201 en 331 ms, total 31470, stock 30→27 | Aprobado |
| CU01-02 | CU-01 | Cantidad negativa o no numérica (4a) | 400 en ambos | HTTP 400 validacion en 230 ms / HTTP 400 validacion en 228 ms | Aprobado |
| CU01-03 | CU-01 | Cantidad mayor al stock (4b) | 409 «supera el stock disponible» | HTTP 409 validacion en 223 ms — «Datos inválidos» | Aprobado |
| CU01-04 | CU-01 | Dos ventas simultáneas de 15 kg con 27 kg en stock (7a, RNF-11, RNF-13) | Una 201 y otra 409; stock final 12, nunca negativo | 201 / 409, stock final 12 | Aprobado |
| CU01-05 | CU-01 | Rol TI no registra ventas (1a) | 403 | HTTP 403 prohibido en 248 ms | Aprobado |
| CU01-06 | CU-01 | Venta que deja el stock bajo el mínimo | 201 y stock 3 kg | HTTP 201 en 605 ms | Aprobado |
| CU04-11 | CU-04 | Eliminar producto con ventas (3a, RNF-10) | 409 ofreciendo la baja lógica | HTTP 409 tiene_historial en 227 ms | Aprobado |
| CU08-01 | CU-08 | Predicción semanal con el modelo activo (Alitas de Pollo) | 201, origen modelo, demanda > 0 y latencia del motor < 2.000 ms | HTTP 201 en 413 ms, origen modelo, demanda 25.4 kg, latencia motor 156 ms | Aprobado |
| CU10-01 | CU-10 | Una sola predicción por producto, horizonte y fecha objetivo | El segundo cálculo reemplaza al primero (mismo id) | ids 925 / 925 | Aprobado |
| CU08-02 | CU-08 | Predicción mensual | 201, horizonte mes y 28–31 días | HTTP 201 en 1057 ms, origen modelo, demanda 124.52 | Aprobado |
| CU11-01 | CU-11 | Producto nuevo sin historial: respaldo por categoría (CU-08 1a) | 201, origen categoria, sin modelo, demanda > 0 | HTTP 201 en 268 ms, origen categoria, demanda 30.4 | Aprobado |
| CU11-02 | CU-11 | Producto con historial propio: respaldo por promedio histórico (3) | 201, origen promedio_historico y demanda 27 kg (27 kg vendidos ÷ 7 días × 7) | HTTP 201 en 265 ms, origen promedio_historico, demanda 27 | Aprobado |
| CU11-03 | CU-11 | Producto nuevo en categoría sin historial (4a) | Origen categoria con demanda 0 (sin proyección) | HTTP 201 en 602 ms, origen categoria, demanda 0 | Aprobado |
| CU08-03 | CU-08 | Operador no puede forzar el cálculo | 403 | HTTP 403 prohibido en 223 ms | Aprobado |
| CU10-02 | CU-10 | Horizonte no permitido (2a) | 400 | HTTP 400 validacion en 224 ms | Aprobado |
| CU09-01 | CU-09 | Recalcular proyecciones y alertas de todos los productos | 200 con productos evaluados | HTTP 200 en 386 ms, {"evaluados":29,"creadas":0,"actualizadas":19,"cerradas":0} | Aprobado |
| CU09-02 | CU-09 | Producto con 3 kg y demanda de 27 kg/semana queda en quiebre (2) | Nivel quiebre con cantidad sugerida y fecha límite | nivel quiebre, demanda 27, sugerido 14.1 kg, límite 2024-09-29 | Aprobado |
| CU09-05 | CU-09 | Sin demanda proyectada: umbral por stock mínimo (2a) | Producto C con 4 kg y mínimo 5 kg en nivel bajo | nivel bajo, demanda 0, sugerido 1.5 | Aprobado |
| CU09-03 | CU-09 | Semáforo consolidado | quiebre + bajo + óptimo = total | {"quiebre":16,"bajo":4,"optimo":9,"total":29} | Aprobado |
| CU09-04 | CU-09 | Sugerencias coherentes en productos reales | Cantidades ≥ 0 y fecha límite no anterior a hoy | 15 sugerencias, hoy=2024-09-29 | Aprobado |
| CU03-01 | CU-03 | Dashboard con indicadores, semáforo y tendencia | 200 con datos del inventario | HTTP 200 en 1413 ms, claves: generado_en, hoy, fecha_demo, origen_proyeccion, kpis, semaforo, tendencia, sugerencias | Aprobado |
| CU03-02 | CU-03 | Dashboard sin sesión (2a) | 401 | HTTP 401 no_autenticado en 235 ms | Aprobado |
| CU05-01 | CU-05 | Alerta activa del producto de prueba con su detalle | Nivel, stock, sugerencia, proveedor, lead time y fecha límite | alerta 20: quiebre, stock 3, sugerido 14.1, límite 2024-09-29 | Aprobado |
| CU05-02 | CU-05 | Alertas ordenadas por nivel de riesgo (paso 2) | quiebre antes que bajo | 19 alertas activas | Aprobado |
| CU05-03 | CU-05 | Operador intenta atender una alerta | 403 | HTTP 403 prohibido en 238 ms | Aprobado |
| CU05-04 | CU-05 | Atender alerta | 200, estado atendida con fecha de resolución | HTTP 200 en 237 ms, resuelta_en 2024-09-29T15:17:39.012Z | Aprobado |
| CU05-05 | CU-05 | Alerta ya resuelta desde otra sesión (3a) | 409 ya_resuelta | HTTP 409 ya_resuelta en 244 ms — «La alerta ya fue atendida. Actualizamos el listado.» | Aprobado |
| CU05-06 | CU-05 | Descartar alerta | 200, estado descartada | HTTP 200 en 237 ms | Aprobado |
| CU05-07 | CU-05 | Las alertas resueltas dejan de figurar como activas | Sin alertas activas de los productos de prueba | 17 alertas activas | Aprobado |
| CU06-01 | CU-06 | TI consulta el modelo activo y su MAE | 200 con modelo activo, MAE general y festivo | RandomForestRegressor 1.1.0, MAE 5.237 / festivos 8.933, mejora 6 % | Aprobado |
| CU06-02 | CU-06 | Operador no accede a la precisión del modelo | 403 | HTTP 403 prohibido en 229 ms | Aprobado |
| CU06-03 | CU-06 | Artefacto inexistente (4a) | 400 junto al campo artefacto_ruta | HTTP 400 validacion en 235 ms | Aprobado |
| CU06-04 | CU-06 | Fechas de prueba inválidas (4b) | 400 | HTTP 400 validacion en 239 ms | Aprobado |
| CU06-05 | CU-06 | Registrar versión con artefacto existente | 201 en estado inactivo | HTTP 201 en 237 ms | Aprobado |
| CU06-06 | CU-06 | Activar versión con MAE peor sin confirmar (6a) | 409 requiere_confirmacion y el modelo activo no cambia | HTTP 409 requiere_confirmacion en 250 ms — «El MAE de esta versión (6.237 kg) es mayor que el del modelo activo (5.237 kg). Confirma para activarla de todos modos.» | Aprobado |
| CU06-07 | CU-06 | Existe un único modelo activo y sigue siendo el original | Activo 1.1.0 | activo 1.1.0 | Aprobado |
| CU13-01 | CU-13 | Mensaje neutro: no revela si el correo existe (2) | 202 con la misma respuesta para correo existente e inexistente | HTTP 202 en 224 ms / HTTP 202 en 223 ms | Aprobado |
| CU13-02 | CU-13 | TI emite el enlace de restablecimiento asistido (1b) | 200 con enlace de 30 minutos | HTTP 200 en 231 ms | Aprobado |
| CU13-03 | CU-13 | Solo el rol TI emite enlaces asistidos | 403 para administrador | HTTP 403 prohibido en 210 ms | Aprobado |
| CU13-04 | CU-13 | Nueva contraseña fuera de política (5a) | 400 | HTTP 400 validacion en 242 ms | Aprobado |
| CU13-05 | CU-13 | Restablecer con enlace válido | 200 | HTTP 200 en 2259 ms | Aprobado |
| CU13-06 | CU-13 | Las sesiones anteriores quedan invalidadas (6) | Sesión del operador: 200 antes y 401 después | 200 → 401 | Aprobado |
| CU13-07 | CU-13 | Enlace ya usado (4a) | 400 enlace_invalido | HTTP 400 enlace_invalido en 231 ms | Aprobado |
| CU13-08 | CU-13 | Inicio de sesión con la nueva contraseña | 200 | HTTP 200 en 2144 ms | Aprobado |
| CU07-07 | CU-07 | Cuenta desactivada (4b): sesión vigente y nuevo ingreso rechazados | Sesión 401 y login 401 con el mensaje genérico | desactivar 200, sesión 401, login 401 | Aprobado |
| CU07-08 | CU-07 | Un administrador no puede desactivar su propia cuenta | 409 usuario_propio | HTTP 409 usuario_propio en 228 ms | Aprobado |
| SEG-09 | RNF-08 | Errores sin detalles técnicos (JSON inválido, id inválido, ruta inexistente) | 4xx con código y mensaje, sin SQL ni trazas | HTTP 400 json_invalido en 531 ms / HTTP 400 validacion en 534 ms / HTTP 404 ruta_no_encontrada en 219 ms | Aprobado |
| SEG-10 | RNF-07 | El panel /api/status no expone credenciales | 200 sin cadenas de conexión, secretos ni contraseñas | HTTP 200 en 222 ms, 1163 bytes | Aprobado |
| SEG-11 | RNF-07 | El JavaScript público del frontend no contiene credenciales | Ninguna cadena de conexión ni nombre de secreto | 11 archivos revisados | Aprobado |
| SEG-12 | RNF-09 | El límite de intentos cuenta por cliente (4 solicitudes seguidas del mismo equipo) | remaining decrece de uno en uno en un único contador | remaining: 18 → 17 → 16 → 19 — el contador cambia entre solicitudes: la clave no es la IP del cliente | Fallido |
| CAR-01 | RNF-03 / RNF-12 | 30 consultas simultáneas (dashboard, productos y sugerencias) | Sin errores 5xx; el pool encola sin agotar el pooler | 29/30 con 200, mediana 2987 ms, máx 11384 ms, lote 11411 ms | Fallido |
| CAR-02 | RNF-19 | La API sigue sana tras la carga | 200 database OK | HTTP 200 en 232 ms | Aprobado |
| CU07-09 | CU-07 | Cerrar sesión elimina la cookie | 204 y Set-Cookie que vence nx_token | HTTP 204 en 213 ms | Aprobado |
| CU07-10 | CU-07 | Reutilizar el token copiado después de cerrar sesión | Idealmente 401 (revocación del lado del servidor) | HTTP 200 — el JWT sigue vigente hasta su expiración (8 h) | Observación |

| Operación | Cota | Mediciones (ms) | Máximo | Cumple |
|---|---|---|---|---|
| CU-07 — Inicio de sesión (pasos 4–6) | 2 s | 2225 | 2225 | No |
| CU-12 — Alta de usuario del equipo (pasos 4–6) | 2 s | 2909 | 2909 | No |
| CU-07 — Inicio de sesión (operador) | 2 s | 2349 | 2349 | No |
| CU-07 — Inicio de sesión (TI) | 2 s | 2302 | 2302 | No |
| CU-04 — Crear categoría (pasos 6–8) | 2 s | 263 | 263 | Sí |
| CU-04 — Crear proveedor (pasos 6–8) | 2 s | 551 | 551 | Sí |
| CU-04 — Crear producto (pasos 6–8) | 2 s | 386 | 386 | Sí |
| CU-04 — Editar producto (pasos 6–8) | 2 s | 667 | 667 | Sí |
| CU-02 — Registrar compra (pasos 7–8) | 2 s | 321 | 321 | Sí |
| CU-01 — Registrar venta (pasos 7–8) | 2 s | 331 | 331 | Sí |
| CU-01 — Validación de datos (paso 4) | 1 s | 230 | 230 | Sí |
| CU-08 — Generar predicción con el modelo (Alitas de Pollo) | 2 s | 413 | 413 | Sí |
| CU-11 — Respaldo por categoría | 1 s | 268 | 268 | Sí |
| CU-09 — Semáforo y sugerencias del conjunto de productos | 1 s | 269, 351, 285, 264, 578 | 578 | Sí |
| CU-03 — Carga del dashboard (API directa) | 3 s | 1413, 1015, 1091, 1095, 1199 | 1413 | Sí |
| CU-03 — Carga del dashboard (vía frontend Vercel) | 3 s | 1435, 1102, 1098 | 1435 | Sí |
| CU-05 — Listar alertas activas (paso 2) | 2 s | 242 | 242 | Sí |
| CU-05 — Atender alerta (paso 6) | 1 s | 237 | 237 | Sí |
| CU-06 — Consultar precisión del modelo | 2 s | 639 | 639 | Sí |
| CU-06 — Registrar versión del modelo (pasos 4–5) | 2 s | 237 | 237 | Sí |
| CU-13 — Solicitar enlace (paso 2) | 2 s | 224 | 224 | Sí |
| CU-13 — Restablecer contraseña (paso 6) | 2 s | 2259 | 2259 | No |
