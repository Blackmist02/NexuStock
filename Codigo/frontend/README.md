# Frontend NexuStock (Next.js 16 · React 19 · TypeScript)

```bash
npm install
npm run dev        # http://localhost:3001 (el backend debe estar en el puerto 4000)
npm run lint && npm run build
```

`/api/*` se reenvía al backend (`API_URL`, por defecto `http://localhost:4000`; se lee al ejecutar, no al compilar), así la cookie de
sesión viaja por el mismo origen. Para producción: `npm run build && API_URL=http://backend:4000 npm start -- -p 3001`.

## Pantallas

| Ruta | Contenido |
| --- | --- |
| `/login` · `/crear-cuenta` · `/recuperar-contrasena` | Acceso, primera cuenta (negocio + términos) y recuperación. |
| `/dashboard` | KPIs, semáforo, tendencia real vs. proyectada, sugerencias de compra (buscar, exportar CSV, registrar venta/compra). |
| `/inventario` · `/inventario/[id]` | Productos con filtros Quiebre/Bajo/Óptimo, alta y edición, detalle con movimientos y aviso de agotamiento. |
| `/inventario/proveedores` | Proveedores (lead time, días hábiles) y categorías. |
| `/prediccion` · `/prediccion/calendario` · `/prediccion/modelo` | Demanda proyectada y alertas (atender/descartar), calendario de eventos, precisión y versiones del modelo. |
| `/historial` | Ventas y compras por período, totales, ventas por semana y exportación CSV. |
| `/configuracion` | Negocio, alertas, equipo y permisos por rol (administrador y TI). |

Temas oscuro y crema, adaptado a móvil. Los botones se muestran según el rol (`src/lib/permisos.ts`, misma matriz que aplica la API).
Sin conexión, las vistas de lectura muestran los últimos datos guardados en el dispositivo.

## Estructura

`src/app` (rutas) · `src/components` (shell, modales en `modales/`, gráficos SVG propios en `charts/`, campos en `ui/`) · `src/lib` (cliente API, `useApi`, formato es-CL, permisos, tipos) · `src/styles` (tokens, UI global, vistas).
