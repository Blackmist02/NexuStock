# Backend NexuStock (Node.js + Express 5 + PostgreSQL)

Puerto 4000. La base de datos es la de `../init.sql` (no se modifica: el backend solo lee y escribe en las tablas existentes).

## Arranque

```bash
docker compose up -d --build      # desde Codigo/: PostgreSQL + backend (o usa iniciar-servidor.bat en Windows)
docker compose exec backend npm run seed:demo   # opcional: carga proveedores, productos y ~70 días de ventas de ejemplo
```

La primera cuenta se crea desde el frontend (*Crear cuenta*): es administrador y pide el nombre de la carnicería. Después el registro
público se cierra y el equipo se crea en *Configuración* (`ALLOW_PUBLIC_SIGNUP=true` lo mantiene abierto).
`seed:demo` necesita que ya exista al menos un usuario y se niega a correr si ya hay productos (`-- --force` para agregar igual).

## Roles y permisos

| Acción | administrador | operador | ti |
| --- | :-: | :-: | :-: |
| Ver inventario, dashboard, predicciones, historial | ✓ | ✓ | ✓ |
| Registrar ventas y compras (RF-01, RF-02) | ✓ | ✓ | — |
| Productos, categorías, proveedores, calendario, configuración y usuarios | ✓ | — | ✓ |
| Atender o descartar alertas (RF-05) | ✓ | — | — |
| Recalcular predicciones y alertas | ✓ | — | ✓ |
| Ver precisión del modelo | ✓ | — | ✓ |
| Registrar y activar versiones del modelo (RF-06), enlaces de restablecimiento (RF-13) | — | — | ✓ |

## Endpoints

Todos bajo `/api`, con sesión salvo los marcados «público». Sesión: cookie `nx_token` (httpOnly) o `Authorization: Bearer <token>`;
las peticiones que modifican datos con cookie llevan `x-nx-csrf: 1`. Errores: `{ "error": { "code", "message", "details?: [{campo, mensaje}]" } }`
(`validacion` = datos inválidos, con el campo; 409 = conflicto de negocio, p. ej. stock insuficiente).

| Ruta | Descripción |
| --- | --- |
| `GET /health` · `GET /auth/setup-status` (público) | Estado del backend; si falta crear la primera cuenta / si el registro está abierto. |
| `POST /auth/register` · `login` · `logout` · `GET /auth/session` · `GET /auth/me` | Cuenta y sesión. `register`: `{nombre, email, password, negocio, acepta_terminos}` (negocio y términos solo para la primera). |
| `POST /auth/forgot` · `POST /auth/reset` (público) | Recuperar contraseña con enlace de un solo uso (30 min). |
| `GET /dashboard` | KPIs, semáforo, tendencia real vs. proyectada, sugerencias de compra y productos críticos. |
| `GET /products?q&nivel&categoria&estado` · `GET /products/export.csv` · `GET /products/:id` | Inventario con estado Quiebre / Bajo / Óptimo; detalle con serie 30 días, movimientos y sugerencia. |
| `POST /products` · `PUT /products/:id` · `PATCH /products/:id/estado` · `DELETE /products/:id` | Catálogo (RF-03). Con historial no se elimina: se desactiva (409 `tiene_historial`). |
| `GET/POST /categories` · `PUT/DELETE /categories/:id` | Categorías. |
| `GET/POST /suppliers` · `PUT/DELETE /suppliers/:id` · `PATCH /suppliers/:id/estado` | Proveedores con lead time y días hábiles. |
| `GET/POST /sales` · `GET/POST /purchases` | Ventas y compras (RF-01/02): actualizan el stock en una transacción y reevalúan la alerta del producto. |
| `GET /alerts?estado` · `PATCH /alerts/:id` · `POST /alerts/evaluate` · `GET /alerts/recommendations[?format=csv]` | Alertas (RF-05, 09, 10). |
| `GET /predictions/resumen` · `GET /predictions/producto/:id/serie` · `POST /predictions/generar` | Demanda proyectada (RF-08). |
| `GET /models` · `POST /models` · `PATCH /models/:id/activar` | Precisión y versiones del modelo (RF-06, RF-07). |
| `GET /history` · `GET /history/export.csv` | Historial de movimientos, totales y ventas por semana. |
| `GET/POST /events` · `DELETE /events/:id` | Calendario de eventos (feriados de Chile, Fiestas Patrias, Semana Santa, propios). |
| `GET/POST /users` · `PATCH /users/:id` · `POST /users/:id/reset-link` | Equipo (RF-12, RF-13). |
| `GET/PUT /config` | Nombre del negocio y activación de alertas de quiebre / bajo. |

## Cómo se calcula

- **Nivel**: Quiebre si stock < demanda proyectada; Bajo si stock < demanda × (1 + margen de seguridad); también aplica `stock_minimo`. Óptimo en otro caso.
- **Cantidad sugerida** = demanda × (1 + margen) − stock, acotada por la vida útil del producto.
- **Fecha límite de pedido** = fecha estimada de quiebre − lead time del proveedor, ajustada al día hábil anterior y nunca anterior a hoy.
- **Demanda** (`services/demanda.js`): modelo activo del motor predictivo con límite de 2 s; si no está disponible, promedio histórico del producto y, sin ventas, de su categoría (RF-11). Ver `../ml-engine/README.md`.
- **Alertas** (`services/alertas.js`): se evalúan al registrar una venta o compra, al cambiar el catálogo, cada `EVALUACION_CADA_MIN` minutos y con *Recalcular*. Una alerta se cierra sola como «atendida» cuando el producto vuelve a óptimo; una descartada no se vuelve a crear durante 24 h salvo que empeore.
- **Parámetros del negocio** (nombre, alertas activas) viven en `data/negocio.json` (`DATA_DIR`), porque el esquema de la base no tiene tabla de configuración. El calendario de feriados 2022–2027 se carga solo la primera vez.

## Variables de entorno

Ver `../.env.example`. `JWT_SECRET` (obligatorio en producción, mínimo 32 caracteres), `CORS_ORIGIN`, `APP_URL`, `ALLOW_PUBLIC_SIGNUP`, `COOKIE_SECURE`,
`TRUST_PROXY`, `AUTH_RATE_LIMIT`, `SMTP_URL`/`MAIL_FROM`, `TZ_NEGOCIO`, `DATA_DIR`, `ML_ENGINE_DIR`, `ML_TIMEOUT_MS`, `PYTHON_BIN`, `CAPACIDAD_KG_SEMANA`, `EVALUACION_CADA_MIN`.
Sin `SMTP_URL`, el enlace de recuperación de contraseña se imprime en el log del backend.

## Pruebas

```bash
npm test                                                             # reglas de negocio y utilidades (sin base de datos)
TEST_DATABASE_URL=postgres://nexustock:nexustock_dev@localhost:5433/nexustock_test npm test   # + API completa contra PostgreSQL
```

La prueba de la API **borra y recrea el esquema** de la base indicada (debe llamarse `*_test`) y la carga con `../init.sql`.
Crea la base antes: `docker compose exec db psql -U nexustock -c "CREATE DATABASE nexustock_test"`.
