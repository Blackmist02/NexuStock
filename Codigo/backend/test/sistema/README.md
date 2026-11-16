# Pruebas de integración y de sistema (tarea #28)

Scripts que recorren los casos de uso CU-01 a CU-13 sobre un entorno desplegado. No forman parte de `npm test` ni del CI porque crean datos en el entorno al que apuntan. El plan, los resultados y los defectos están en [INFORME.md](INFORME.md).

| Archivo | Qué hace | Dónde corre |
|---|---|---|
| `sistema.js` | 93 casos funcionales, de seguridad y de rendimiento por la API real (cuentas, catálogo, ventas, compras, predicción, semáforo, alertas, modelo, recuperación de contraseña, carga concurrente). | Demo (Render + Vercel + Supabase) |
| `fallas.js` + `motores/*.py` | Motor normal, lento (5 s), caído e inválido; base de datos detenida y recuperada. | Instancia local desechable (Docker) |
| `ui.js` | Navegador real (Edge/Chrome) en escritorio y móvil: login, dashboard, corte y recuperación de la conexión, copia local y cierre de sesión. | Frontend de la demo |
| `evidencias/` | Resultados JSON, capturas, registros y la matriz completa de la corrida del 16-11-2026. | — |

## Reglas

- **Nunca uses una cuenta real.** Los scripts exigen una cuenta del dominio reservado `@nexustock.test` (no puede recibir correo). Crea un administrador de prueba directamente en la base, porque el registro público está cerrado, y bórralo al terminar.
- Todo lo que crea `sistema.js` lleva el prefijo `QA-28` (categorías, proveedores, productos y modelos `qa28-*`). Las ventas y compras solo tocan esos productos.
- **Limpieza** al terminar, en una transacción y en este orden: alertas, predicciones, ventas, compras y mermas de los productos `QA-28%`; después los productos, proveedores y categorías `QA-28%`, los modelos `qa28%` inactivos y los usuarios `qa-%@nexustock.test`. Comprueba antes que los usuarios QA no tengan movimientos sobre productos reales.
- El límite de autenticación (20 intentos cada 15 minutos) alcanza para una sola ejecución de `sistema.js`. Espera 15 minutos antes de repetirla.
- Las fallas **no se provocan en la demo**: detener la base o cambiar el motor afectaría a todos sus usuarios.

## Ejecución

```bash
cd Codigo/backend

# 1. Sistema contra la demo
QA_EMAIL=qa-admin@nexustock.test QA_PASSWORD=... node test/sistema/sistema.js

# 2. Fallas: copia de la base local + una instancia por motor (imagen nexustock-backend de docker compose)
#    docker run ... -e ML_PREDICT_SCRIPT=/qa/lento.py -v ./test/sistema/motores:/qa:ro nexustock-backend node src/app.js
QA_EMAIL=... QA_PASSWORD=... node test/sistema/fallas.js --api http://localhost:4111 --escenario motor-lento
QA_EMAIL=... QA_PASSWORD=... node test/sistema/fallas.js --api http://localhost:4110 --escenario bd --contenedor-bd nexustock-db

# 3. Navegador (playwright-core no es dependencia del proyecto)
npm i --no-save playwright-core
QA_EMAIL=... QA_PASSWORD=... node test/sistema/ui.js
```

Espera unos 15 s después de levantar cada instancia local: el modelo real tarda unos 3 s en cargar después de que la API abre el puerto. Los resultados quedan en `test/sistema/resultados/` (ignorado por git); si una corrida sirve como evidencia, cópiala a `evidencias/`.
