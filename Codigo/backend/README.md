# Backend NexuStock (Node.js + Express 5 + PostgreSQL)

Puerto 4000. La base de datos es la de `../init.sql` (no se modifica: el backend solo lee y escribe en las tablas existentes).

## Endpoints disponibles

| Método y ruta | Acceso | Descripción |
| --- | --- | --- |
| `GET /api/health` | público | Estado del backend y de la base. |
| `GET /api/auth/setup-status` | público | `{ necesitaRegistro, registroAbierto }`. |
| `POST /api/auth/register` | público (según `ALLOW_PUBLIC_SIGNUP`) | Crear cuenta. La primera cuenta es `administrador`; las siguientes, `operador`. |
| `POST /api/auth/login` | público | Inicia sesión (cookie `nx_token` httpOnly + token en la respuesta). |
| `POST /api/auth/logout` | — | Cierra sesión. |
| `GET /api/auth/session` | público | Usuario actual o `{ user: null }`. |
| `GET /api/auth/me` | sesión | Usuario actual (401 sin sesión). |
| `POST /api/auth/forgot` · `POST /api/auth/reset` | público | Recuperar contraseña (enlace de un solo uso, 30 min). |
| `GET /api/dashboard` | sesión | KPIs, semáforo, tendencia de ventas, sugerencias de compra y productos críticos (solo lectura). |
| `GET /api/products`, `/api/products/:id`, `/api/categories`, `/api/suppliers` | público (sin cambios) | Catálogo existente. |

Sesión: cookie `nx_token` o cabecera `Authorization: Bearer <token>`. Las peticiones que modifican datos con cookie deben llevar `x-nx-csrf: 1`.
Errores: `{ "error": { "code", "message", "details?" } }`.

## Cómo calcula el dashboard

Solo lee (`productos`, `categorias`, `proveedores`, `ventas`, `predicciones`); no escribe en `ALERTAS_INVENTARIO` ni en `PREDICCIONES`.
La demanda semanal sale de un respaldo estadístico (`src/services/demanda.js`: promedio de las últimas semanas de ventas; sin historial,
promedio de la categoría). Cuando el modelo de ML esté listo, se registra con `setDemandProvider()` sin tocar el resto.

- Quiebre: stock < demanda · Bajo: stock < demanda × (1 + margen de seguridad) · también aplica `stock_minimo` (sin stock = quiebre; bajo el mínimo = bajo).
- Cantidad sugerida = demanda × (1 + margen) − stock.
- Fecha límite de pedido = fecha estimada de quiebre − lead time del proveedor, ajustada al día hábil anterior (`dias_habiles`) y nunca anterior a hoy.
- La línea «proyectada» de la tendencia usa `predicciones` si hay registros; si no, la demanda semanal total actual.

## Variables de entorno

Ver `../.env.example`. `JWT_SECRET` (obligatorio en producción, mínimo 32 caracteres), `CORS_ORIGIN`, `APP_URL`, `ALLOW_PUBLIC_SIGNUP`,
`COOKIE_SECURE`, `TRUST_PROXY`, `AUTH_RATE_LIMIT`, `SMTP_URL`/`MAIL_FROM`, `TZ_NEGOCIO`, `DEMANDA_SEMANAS_HISTORIAL`.
Sin `SMTP_URL`, el enlace de recuperación de contraseña se imprime en el log del backend.

## Pruebas

`npm test` ejecuta las pruebas de las reglas de negocio (no usan la base de datos).
