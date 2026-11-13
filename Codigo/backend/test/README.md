# Pruebas del backend

```bash
npm test                 # pruebas unitarias (sin base de datos)
TEST_DATABASE_URL=postgres://nexustock:nexustock_dev@localhost:5433/nexustock_test npm test   # + pruebas de la API
npm run lint             # ESLint
```

Las pruebas usan `node:test` y `node:assert` (sin dependencias extra). En CI ([.github/workflows/ci.yml](../../../.github/workflows/ci.yml), job *Backend*) se ejecutan en cada push y pull request junto con las de la API, contra un PostgreSQL 16 descartable creado con `Codigo/init.sql`.

| Archivo | Tipo | Qué cubre |
|---|---|---|
| `reglas.test.js` | Unitarias | Semáforo, horizonte de reposición con el calendario del proveedor, cantidad sugerida, tope por vida útil, fecha de quiebre y fecha límite de pedido, política de contraseña. |
| `bordes.test.js` | Unitarias | Casos borde del semáforo y de la sugerencia; respaldo de demanda por promedio histórico y por categoría. |
| `seguridad.test.js` | Unitarias | Hash de contraseñas, expiración y validez del token, roles, CSRF y límite de intentos. |
| `alertas.test.js`, `utilidades.test.js` | Unitarias | Causa de cada alerta, lectura y escritura de CSV, feriados de Chile y fechas. |
| `api.test.js` | Integración | Flujos de la API de punta a punta (cuentas y roles, catálogo, ventas, compras, alertas, predicción con respaldo, CSV). Requiere `TEST_DATABASE_URL` (la base debe terminar en `_test`). |

## Tarea 27: criterios de aceptación y pruebas que los cubren

| Criterio | Pruebas |
|---|---|
| **1. Casos borde del semáforo** | |
| Stock en cero | `bordes` › *stock en cero*: quiebre por demanda y por mínimo (también con saldo negativo), agotamiento hoy y pedido = demanda + margen. |
| Picos estacionales | `bordes` › *pico estacional (Fiestas Patrias)*: el mismo stock pasa de óptimo a quiebre, la sugerencia sube a 59,2 kg y el agotamiento se adelanta 2 días. |
| Lead time extendido | `bordes` › *lead time extendido* (30 días: horizonte de 32 días, quiebre con 100 kg, fecha límite = hoy); `reglas` › *días de cobertura* e importado de 21 días. |
| Proveedor sin días hábiles | `bordes` › *sin días hábiles registrados* (`[]`, `null` o sin dato = atención diaria en cobertura, demanda y fecha límite; proveedor de un solo día); `reglas` › *fecha límite… día hábil anterior*. |
| **2. Cálculos** | |
| Cantidad sugerida | `reglas` › ejemplo del documento de diseño (40 kg, demanda 140, margen 10 % → 114 kg), redondeo kg/unidades, nunca negativa, tope por vida útil; `bordes` › *tope por vida útil*. |
| Fecha límite de pedido | `reglas` › *fecha límite de pedido se adelanta al día hábil anterior*; `bordes` › lead time extendido y sin días hábiles. |
| Respaldo por promedio / categoría (RF-11) | `bordes` › *respaldo de demanda*: promedio de la ventana configurada, mínimo 7 días de historial, producto nuevo con el promedio de su categoría, categoría sin historial = 0, producto inactivo sin estimación; `api` › *predicción con respaldo*. |
| **3. Autenticación** | |
| Hash | `seguridad` › bcrypt con costo 12, sal distinta por hash, verificación; `reglas` › política de contraseña y huella. |
| Expiración de token | `seguridad` › 8 h (30 días con «Recordarme»); token expirado, firmado con otra clave, sin firma (`alg: none`) o de recuperación → 401; cambio de contraseña o cuenta desactivada invalidan la sesión. |
| Roles | `seguridad` › `requireRole` (403 al rol no autorizado, 401 sin sesión); `api` › alta de equipo con roles y permisos por rol. |
| Límite de intentos | `seguridad` › con `AUTH_RATE_LIMIT=3`, el 4.º intento en 15 minutos responde 429 `demasiados_intentos` con `Retry-After`. |

Resultado local (13-11-2026): 35 pruebas unitarias aprobadas, 0 fallidas; lint sin observaciones. El resultado oficial es el del job *Backend* del workflow CI.
