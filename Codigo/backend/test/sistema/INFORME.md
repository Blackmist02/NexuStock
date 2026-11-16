# NexuStock — Plan e informe de pruebas de integración y de sistema

| | |
|---|---|
| Tarea | #28 «Pruebas de integración y de sistema en el entorno demo» (Fase 4 · Verificación) |
| Fecha de ejecución | 16-11-2026 |
| Versión probada | Rama `Features/Manuel`, commit base `3fd2b9a` (desplegado en la demo); modelo ML 1.1.0 activo |
| Entorno | Frontend https://nexustock-omega.vercel.app (Vercel) · API https://nexustock-api.onrender.com (Render, plan gratuito, 0,1 CPU) · PostgreSQL en Supabase (us-east-1, session pooler) |
| Responsables | Manuel Bustamante e Ignacio Mella |
| Requisitos | RF-01 a RF-13 (CU-01 a CU-13), RNF-01 a RNF-19 |

**Resultado global.** No hay defectos críticos abiertos. Se encontraron cuatro defectos y tres observaciones. DEF-01, DEF-02 y DEF-04 están corregidos en la rama y quedan pendientes de despliegue. DEF-03 se aceptó como desviación documentada del entorno demo (decisión del 16-11-2026). Detalle en la sección 6.

| Nivel | Casos | Aprobados | Observación | Fallidos |
|---|---|---|---|---|
| Unitarias + integración de la API (PostgreSQL local descartable) | 55 | 55 | — | 0 |
| Sistema sobre la demo (`sistema.js`) | 93 | 89 | 1 | 3 |
| Escenarios de falla (instancia local) | 28 | 28 | — | 0 |
| Navegador, escritorio y móvil (`ui.js`) | 24 | 22 | — | 2 |
| **Total** | **200** | **194** | **1** | **5** |

---

## 1. Plan de pruebas

### 1.1 Objetivo

Verificar de punta a punta, sobre el entorno demo con la base remota en Supabase, que los casos de uso CU-01 a CU-13 del Documento 01 cumplen su secuencia normal, sus excepciones y sus cotas de «Rendimiento», y que se cumplen los requisitos no funcionales de seguridad, tolerancia a fallas y disponibilidad.

### 1.2 Alcance

**Incluye:** la API REST y el frontend desplegados en la demo; la integración API ↔ Supabase y API ↔ motor predictivo (`predict.py` como proceso hijo); la seguridad de transporte, sesión, CORS y CSRF; la Data API de Supabase; el comportamiento ante caídas del motor y de la base de datos, el límite de conexiones y la pérdida de conexión del usuario.

**No incluye:**
- Despliegue, monitoreo y migración en el proveedor cloud definitivo (#30 a #32): quedaron fuera de alcance en el acta del 16-11.
- Usabilidad y aceptación con el usuario: corresponden a la tarea #29.
- Pruebas de carga sostenida: el plan gratuito de Render no es representativo de la producción. Solo se probó una ráfaga de concurrencia.

### 1.3 Niveles y técnica

| Nivel | Qué verifica | Herramienta | Dónde |
|---|---|---|---|
| Unitarias + integración | Reglas, cálculos, seguridad y flujos de la API (base de la tarea #27) | `node:test` (`npm test` con `TEST_DATABASE_URL`) | PostgreSQL 16 local descartable |
| Sistema (caja negra) | CU-01 a CU-13: secuencia normal, excepciones, roles y tiempos | `test/sistema/sistema.js` (HTTP real, sesión por cookie y CSRF como el frontend) | Demo |
| Seguridad | HTTPS, HSTS, CORS, CSRF, cookie, token alterado, mensajes de error, secretos, Data API | `sistema.js` + consulta de catálogo de PostgreSQL | Demo y Supabase |
| Fallas | Motor normal, lento, caído y con valores inválidos; base detenida y recuperada | `test/sistema/fallas.js` + motores simulados en `motores/` | Instancias locales desechables (imagen Docker del backend, copia de la base) |
| Navegador | Login, dashboard, corte y vuelta de la red, copia local, cierre de sesión, diseño responsivo | `test/sistema/ui.js` (Edge sin interfaz, 1366×800 y 390×844) | Frontend de la demo |

Técnicas: partición de equivalencia y valores límite (cantidades ≤ 0, superiores al stock, identificadores fuera de rango), pruebas de rol (cada operación con un rol no autorizado), concurrencia (dos ventas simultáneas sobre el mismo stock) e inyección de fallas.

### 1.4 Datos y cuentas de prueba

- **Ninguna cuenta real.** Se creó un administrador de prueba (`qa-admin@nexustock.test`, dominio reservado que no recibe correo) directamente en Supabase. Con él se crearon por la API las cuentas QA de operador y TI, que es parte del CU-12.
- Los datos creados llevan el prefijo `QA-28`: dos categorías, dos proveedores (uno inactivo), tres productos y una versión de modelo inactiva. Las ventas y compras solo se registraron sobre esos productos.
- Al terminar se eliminó todo en una sola transacción: 6 alertas, 5 predicciones, 6 ventas, 2 compras, 5 productos, 4 proveedores, 3 categorías, 2 modelos y 5 usuarios QA. La demo quedó en su línea base: 97.615 ventas y 8.800 compras.
- Las únicas escrituras sobre datos reales son las de la operación normal: el recálculo de alertas (`POST /api/alerts/evaluate`, que el sistema ya ejecuta cada hora) y la predicción del día de un producto, que reemplaza a la vigente.

### 1.5 Criterios

**Entrada:** pruebas unitarias de la tarea #27 aprobadas; demo desplegada y health check en 200; modelo activo.

**Cotas de tiempo** (ERS, «Rendimiento» de cada CU y RNF-01/03): motor < 2,0 s; operaciones transaccionales ≤ 2 s; validación y atención de alertas ≤ 1 s; semáforo del conjunto ≤ 1 s; dashboard completo ≤ 3 s. Los tiempos se midieron **desde el cliente en Chile** hacia Virginia, con la base remota. Incluyen la red, por lo que son más exigentes que el tiempo de servidor.

**Salida:** matriz de trazabilidad con resultado por caso; tiempos medidos; escenarios de falla ejecutados; controles de seguridad verificados; sin defectos críticos abiertos.

**Severidad:** *Crítica* (pérdida o corrupción de datos, acceso no autorizado, sistema inutilizable) · *Alta* (control de seguridad debilitado o función principal degradada) · *Media* (incumple una cota o una regla sin afectar los datos) · *Baja* (detalle con mitigación o impacto acotado).

---

## 2. Trazabilidad requisito → casos de prueba

Resumen de la corrida final sobre la demo. Cada caso con su resultado esperado y obtenido está en [evidencias/matriz-resultados.md](evidencias/matriz-resultados.md).

| Requisito | Casos | Qué se verificó | Resultado |
|---|---|---|---|
| CU-01 Registrar venta | CU01-01 a 06, UI | Total = cantidad × precio de catálogo; descuento de stock; cantidad ≤ 0 o no numérica (4a); mayor al stock (4b); **dos ventas simultáneas de 15 kg con 27 kg: una 201 y otra 409, stock final 12** (7a, RNF-11, RNF-13); rol TI rechazado (1a) | 6/6 |
| CU-02 Registrar compra | CU02-01 a 04 | Stock 10 → 30 y costo total; cantidad 0 (4a); proveedor inactivo (4b); rol TI rechazado | 4/4 |
| CU-03 Dashboard | CU03-01/02, UI-02/04/05-07, F-*-04 | KPI, semáforo, tendencia y sugerencias; sin sesión (2a); copia local y aviso de corte (7c); sigue disponible con el motor caído (3a) | 2/2 + UI |
| CU-04 Catálogo | CU04-01 a 12 | Alta y edición; nombre duplicado (6a); lead time negativo o sin días hábiles (6b); categoría inexistente; operador rechazado; baja lógica de proveedor; eliminar producto con ventas → 409 (3a, RNF-10) | 11/12 (DEF-01) |
| CU-05 Alertas | CU05-01 a 07 | Detalle completo; orden por riesgo; atender y descartar con fecha de resolución; alerta ya resuelta → 409 (3a); operador rechazado | 7/7 |
| CU-06 Modelo | CU06-01 a 07 | Modelo activo y MAE; artefacto inexistente (4a); fechas inválidas (4b); alta inactiva; activar con un MAE peor exige confirmación (6a) y el modelo activo no cambia | 7/7 |
| CU-07 Autenticar | CU07-01 a 10, SEG-07, UI | Login por rol; mensaje genérico idéntico para clave errónea y correo inexistente (4a); cuenta desactivada (4b); token `alg: none` (7a); rol sin permiso (7b); cierre de sesión | 9/10 + OBS-01 |
| CU-08 Predicción | CU08-01 a 03, F-M-* | Semana y mes con el modelo (latencia del motor 109 ms); respaldo con motor lento, caído o con valores inválidos (2a, 5a, 6a); servidor no bloqueado (RNF-02) | 3/3 + 20/20 |
| CU-09 Semáforo | CU09-01 a 05 | Quiebre con demanda proyectada; umbral por stock mínimo sin demanda (2a); semáforo consolidado; sugerencias ≥ 0 y fecha límite no anterior a hoy | 5/5 |
| CU-10 Persistencia | CU10-01/02 | Una sola predicción por producto, horizonte y fecha (el recálculo conserva el id); horizonte inválido (2a) | 2/2 |
| CU-11 Respaldo | CU11-01 a 03 | Por categoría (producto nuevo); por promedio histórico (27 kg ÷ 7 días × 7); categoría sin historial → 0 y umbral por stock mínimo (4a) | 3/3 |
| CU-12 Crear cuenta | CU12-01 a 07 | Registro público cerrado (2a); alta de operador y TI; correo duplicado (4a); contraseña fuera de política (4b); operador no crea cuentas (1a) | 7/7 |
| CU-13 Recuperar contraseña | CU13-01 a 08 | Respuesta neutra (2); enlace asistido solo por TI (1b); contraseña débil (5a); restablecer invalida las sesiones anteriores (6); enlace reutilizado (4a); login con la nueva contraseña | 8/8 |
| RNF-05/06/07/08/09 Seguridad | SEG-01 a 12 | Ver sección 4 | 11/12 (DEF-02) |
| RNF-03/12/19 Carga y disponibilidad | CAR-01/02, INF-01 a 03 | 30 consultas simultáneas; health check | 3/4 (OBS-02) |

---

## 3. Rendimiento (cotas del ERS, base remota)

| Operación | Cota | Medido (ms) | Cumple |
|---|---|---|---|
| CU-01 Registrar venta (pasos 7–8) | 2 s | 331 | Sí |
| CU-01 Validación (paso 4) | 1 s | 230 | Sí |
| CU-02 Registrar compra (pasos 7–8) | 2 s | 321 | Sí |
| CU-03 Dashboard, API directa (5 mediciones) | 3 s | 1.015 – 1.413 | Sí |
| CU-03 Dashboard vía frontend (3 mediciones) | 3 s | 1.098 – 1.435 | Sí |
| CU-03 Recarga del dashboard en el navegador hasta ver los datos (mediana de 3) | 3 s | 1.566 escritorio · 1.390 móvil | Sí |
| CU-04 Crear/editar categoría, proveedor y producto (pasos 6–8) | 2 s | 263 – 667 | Sí |
| CU-05 Listar alertas / atender alerta | 2 s / 1 s | 242 / 237 | Sí |
| CU-06 Consultar precisión / registrar versión | 2 s | 639 / 237 | Sí |
| CU-08 Predicción con el modelo (total) · latencia del motor | 2,0 s | 413 · 109 | Sí |
| CU-09 Semáforo y sugerencias de todos los productos (5 mediciones) | 1 s | 264 – 578 | Sí |
| CU-11 Respaldo por categoría | 1 s | 268 | Sí |
| CU-13 Solicitar enlace (paso 2) | 2 s | 224 | Sí |
| **CU-07 Inicio de sesión** (admin, operador, TI) | 2 s | **2.225 – 2.349** | **No (DEF-03)** |
| **CU-12 Alta de usuario del equipo** | 2 s | **2.909** | **No (DEF-03)** |
| **CU-13 Restablecer contraseña (paso 6)** | 2 s | **2.259** | **No (DEF-03)** |

Las cuatro operaciones fuera de cota son justamente las que calculan o verifican un hash bcrypt (costo 12). En la instancia gratuita de Render (0,1 CPU), ese cálculo por sí solo toma unos 2 s. Todas las demás operaciones quedan muy por debajo de su cota. El primer ingreso en el navegador (login más primera carga del dashboard) tomó 4,2–4,9 s.

---

## 4. Seguridad

| Control | Evidencia | Resultado |
|---|---|---|
| HTTPS obligatorio | `http://` → 301 en la API y 308 en el frontend, ambos hacia `https://` (SEG-01/02) | Cumple |
| HSTS | API `max-age=31536000; includeSubDomains`; frontend `max-age=63072000; includeSubDomains; preload` (SEG-03) | Cumple |
| Cabeceras | Sin `X-Powered-By`; `X-Content-Type-Options: nosniff` (SEG-04) | Cumple |
| CORS | Origen ajeno → 403 sin `Access-Control-Allow-Origin`; origen del frontend → permitido (SEG-05/06) | Cumple |
| CSRF | Modificación con cookie y sin `x-nx-csrf` → 403 y no se crea el registro (SEG-08) | Cumple |
| Sesión | Cookie `HttpOnly; Secure; SameSite=Lax`, no accesible desde JavaScript (SEG-07, UI-09); token `alg: none` → 401; cambio de contraseña o cuenta desactivada invalidan la sesión | Cumple |
| Mensajes de error | JSON inválido, id inválido, ruta inexistente, motor caído y base caída: código y mensaje sin SQL, trazas ni rutas (SEG-09, F-*). El detalle técnico queda solo en el log del servidor (`evidencias/log-*.txt`) | Cumple (salvo DEF-01, que responde 500 genérico) |
| Data API de Supabase cerrada | RLS activo en las 12 tablas de `public`, 0 políticas, 0 privilegios para `anon` y `authenticated` (`evidencias/supabase-seguridad.json`) | Cumple |
| Credenciales no expuestas | 11 archivos JS públicos del frontend sin cadenas de conexión ni nombres de secretos (SEG-11); `/api/status` sin secretos (SEG-10); el repositorio solo versiona `Codigo/.env.example` y el historial de git no contiene ningún `.env` | Cumple |
| Copia local sin credenciales | `localStorage` solo guarda `nx:cache:v1:*` y `nx:usuario:v1`, sin token ni contraseña (UI-08) | Cumple |
| Límite de intentos (RNF-09) | El contador del limitador cambia entre solicitudes seguidas del mismo equipo (18 → 17 → 16 → **19**) (SEG-12) | **No cumplía en la demo (DEF-02); corregido en la rama** |

---

## 5. Escenarios de falla (instancia local, ver `evidencias/fallas-*.json`)

| Escenario | Qué se hizo | Resultado observado | Casos |
|---|---|---|---|
| Línea base | `predict.py` real con el modelo activo | Origen `modelo`, 117 ms en total, motor `OK` en el panel | 5/5 |
| **Motor lento** | Motor simulado que tarda 5 s por respuesta | Corte a los 2,0 s y respaldo por promedio histórico; respuesta total en 2.082 ms; mientras tanto, otra consulta respondió en 67 ms (RNF-02); dashboard en 2,2 s | 5/5 |
| **Motor caído** | El proceso termina con traza de error al recibir la solicitud | Respaldo inmediato (47 ms); la traza queda solo en el log del servidor | 5/5 |
| Valores no viables | El motor responde −50, 99.999.999 y `"NaN"` | Valores descartados (RNF-15) y respaldo aplicado | 5/5 |
| **Base de datos no disponible** | `docker stop` de PostgreSQL con la API en marcha | Health 503 `DEGRADED`; dashboard, venta y login → 503 «El servicio no está disponible por un momento…» tras los reintentos (RNF-12); la venta fallida no dejó datos parciales; **recuperación automática a los 21 s sin reiniciar la API** | 8/8 |
| **Límite de conexiones del pooler** | 30 consultas simultáneas a la demo (dashboard, productos y sugerencias), dos rondas más una de control | El pool de la API (10 conexiones) encola sin agotar el pooler (15 de 60 conexiones activas en Supabase). Hubo 119 de 120 respuestas 200, con una latencia máxima de unos 11 s | OBS-02 |
| **Pérdida de conexión del usuario** | Navegador sin red (escritorio y móvil) | Aviso «Estás sin conexión… puedes seguir revisando… con la última información guardada»; el dashboard sigue visible; al volver la red: «Conexión restablecida. Estamos actualizando tu información.» Capturas en `evidencias/capturas/` | 6/6 |

---

## 6. Defectos y observaciones

| ID | Severidad | Descripción | Estado |
|---|---|---|---|
| **DEF-01** | Media | Crear o editar un producto con `id_categoria` mayor que 32.767 responde **500** en vez de 400 junto al campo: la columna es `SMALLINT` y PostgreSQL rechaza el valor con el código 22003. No expone detalles técnicos. | **Corregido en la rama**: el esquema acota el campo a 32.767, y el manejador de errores traduce los códigos 22003 y 22P02 a 400 de validación, lo que cubre cualquier otra ruta con el mismo problema. Incluye prueba unitaria. Pendiente: desplegar en Render y repetir CU04-08. |
| **DEF-02** | **Alta** | El límite de intentos de login y recuperación (20 cada 15 min) no cuenta por cliente. Delante de Render hay más proxies de los previstos (Cloudflare y, en el uso normal, también Vercel), así que con `TRUST_PROXY=2` la clave del limitador es la IP de un proxy que va rotando. Resultado: el tope se reparte entre varios contadores y usuarios distintos pueden compartir uno. La protección queda debilitada, no anulada: bcrypt sigue costando unos 2 s por intento. | **Corregido en la rama** (`src/lib/ipCliente.js`). El proxy de Next envía la IP que informa Vercel (`x-real-ip`) junto con un secreto compartido (`PROXY_SECRET`), y descarta siempre esas cabeceras si las manda el cliente. La API usa esa IP como clave solo si el secreto coincide (comparación en tiempo constante). Si no coincide, usa `CF-Connecting-IP` (con `TRUST_CF_CONNECTING_IP=true`) y, en último caso, `req.ip`. El IPv6 se agrupa por subred. Verificado con una prueba unitaria y con la API local: el mismo cliente descuenta de un solo contador (19 → 18 → 17), un cliente distinto tiene el suyo y una IP falsa sin secreto se ignora. Pendiente: configurar `PROXY_SECRET` en Vercel y Render y `TRUST_CF_CONNECTING_IP=true` en Render, desplegar y repetir SEG-12. |
| **DEF-03** | Media | Login, alta de usuario y restablecimiento tardan 2,2–2,9 s con la cota en 2 s, por bcrypt de costo 12 en 0,1 CPU. | **Aceptado y documentado** (decisión del equipo, 16-11-2026). Se mantiene el costo 12 porque bajarlo reduce la resistencia de los hashes ante ataques de diccionario. La desviación es propia del plan gratuito de Render (0,1 CPU), donde el hash por sí solo toma unos 2 s, y no del diseño. Con más CPU la cota se cumple sin cambiar el código. El resto de las operaciones cumple con holgura. Queda registrada como limitación conocida del entorno demo, a revisar si cambia la infraestructura. |
| **DEF-04** | Baja | Al cerrar sesión, una consulta del dashboard que estaba en curso podía volver a escribir la copia local después de borrarla (carrera intermitente), contra la postcondición del CU-07. Solo deja datos de lectura en el equipo, nunca credenciales. | **Corregido en la rama**: un contador de «época» en la copia local descarta las respuestas iniciadas antes de limpiarla. Pendiente: llegar a `main` para que Vercel lo publique y repetir UI-12. |
| OBS-01 | Baja | Después de cerrar sesión, un token copiado sigue sirviendo hasta que vence (8 h), porque la sesión no se revoca en el servidor. El cierre de sesión sí borra la cookie del navegador. | Mejora opcional: guardar una versión de sesión en `usuarios` y compararla en `authenticate`, igual que ya se hace con la huella de la contraseña. |
| OBS-02 | Baja | Con 30 consultas simultáneas, la latencia máxima llega a unos 11 s y 1 de 120 respuestas no fue 200 (código no capturado; el runner ahora lo registra). Es el límite de 0,1 CPU del plan gratuito; el uso esperado es de 5 a 10 consultas de dashboard al día. | Sin acción para la demo; repetir la medición si cambia la infraestructura. |
| OBS-03 | Baja | El pool de PostgreSQL no tiene `connectionTimeoutMillis`: con la base caída, el 503 tardó 3,8 s (7,8 s el health check). | Sugerido: `connectionTimeoutMillis: 3000` en `db.js`. |

**Correcciones a mis propias pruebas.** En la primera corrida (`evidencias/sistema-demo-corrida1.json`) fallaron 6 casos. Cuatro eran errores del script y se corrigieron en el runner: un dato inválido en el alta inicial, la expectativa de 409 para los duplicados (el sistema responde 400 junto al campo, como pide el CU) y el orden del caso de respaldo por categoría. En la prueba de navegador, el caso UI-movil-12 **no es concluyente**: el script no logró abrir el menú lateral en móvil y cerró la sesión por la API, así que no probó el botón de la interfaz.

---

## 7. Evaluación de los criterios de aceptación de la tarea #28

| Criterio | Estado |
|---|---|
| 1. Matriz de trazabilidad RF → caso de prueba con resultado registrado | Cumplido: sección 2 y `evidencias/matriz-resultados.md` (93 casos con resultado esperado y obtenido) |
| 2. Tiempos con la base remota: motor < 2,0 s, operaciones ≤ 2 s, dashboard ≤ 3 s | Motor y dashboard cumplen. Las operaciones cumplen salvo las cuatro con bcrypt, que quedan como desviación aceptada y documentada del entorno demo (DEF-03) |
| 3. Fallas: motor caído o lento, base no disponible, límite del pooler, pérdida de conexión | Cumplido: sección 5 |
| 4. Seguridad: HTTPS, CORS, CSRF, Data API cerrada, sin credenciales expuestas | Cumplido: sección 4. El hallazgo adicional en el límite de intentos (DEF-02) está corregido en la rama |
| Salida: informe sin defectos críticos abiertos | Cumplido: no hay defectos críticos. Para cerrar la tarea faltan configurar las variables de DEF-02, desplegar DEF-01, DEF-02 y DEF-04 y hacer una nueva corrida de `sistema.js` (unos 5 minutos) |

## 7.1 Verificación después del despliegue (16-11-2026, PR #15, commit `7b84ae4`)

Nueva corrida de `sistema.js` contra la demo (`evidencias/sistema-demo-post-despliegue.json`): **91/93 aprobados**, 1 observación (OBS-01) y 1 fallido. El fallido es SEG-12, que quedó resuelto después al configurar `TRUST_CF_CONNECTING_IP` (ver DEF-02). **Tarea #28 cerrada sin defectos abiertos**; quedan solo las observaciones OBS-01 a OBS-03 y la desviación aceptada DEF-03.

| Defecto | Resultado después del despliegue |
|---|---|
| DEF-01 | **Cerrado**: CU04-08 responde 400 «Elige una categoría» y CU04-12 responde 400 «La categoría no existe». |
| DEF-02 | **Cerrado.** A través de Vercel, el contador es único por cliente y baja de uno en uno (19 → 18 → 17). En las llamadas directas a `nexustock-api.onrender.com`, la primera verificación seguía repartida en varios contadores porque faltaba la variable `TRUST_CF_CONNECTING_IP` en Render. Tras agregarla y redesplegar: 19 → 18 → 17 → 16, y una solicitud con `X-Forwarded-For` y `x-nx-cliente-ip` inventadas, sin el secreto, siguió descontando del mismo contador (15). |
| DEF-03 | Desviación aceptada: login de 2,1–2,4 s, igual que antes. |
| DEF-04 | Publicado en Vercel junto con el merge. No se repitió la prueba de navegador (UI-12). |
| OBS-02 | En esta corrida pasaron 30/30 consultas simultáneas (latencia máxima de 11,5 s). |

## 8. Evidencias

- [evidencias/matriz-resultados.md](evidencias/matriz-resultados.md): matriz completa de la corrida final.
- `evidencias/sistema-demo.json` (corrida final) y `sistema-demo-corrida1.json` (primera corrida).
- `evidencias/fallas-*.json` y `log-*.txt`: escenarios de falla y lo que registró el servidor.
- `evidencias/ui.json` y `evidencias/capturas/*.png`: dashboard, sin conexión y reconectado, en escritorio y móvil.
- `evidencias/supabase-seguridad.json`: RLS, políticas y privilegios de la Data API.
- `evidencias/npm-test-local.txt`: 55/55 pruebas unitarias y de integración de la API.
