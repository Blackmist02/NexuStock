# NexuStock

Sistema web inteligente de gestión y predicción de inventario para carnicerías de gestión independiente.

Proyecto APT (Capstone PTY4614) — Ingeniería en Informática, Duoc UC, sede Alameda. Docente: Felipe Krauss Benavente.

![Dashboard de NexuStock](docs/capturas/10-dashboard.png)

| | |
| --- | --- |
| **Demo en línea** | https://nexustock-omega.vercel.app (frontend) · https://nexustock-api.onrender.com/api/health (API) |
| **Metodología** | Cascada (requerimientos → diseño → construcción → pruebas → despliegue → cierre) con control de cambios |
| **Equipo** | Ignacio Mella (Software Engineer) · Manuel Bustamante (Data Scientist) |

---

## Contenido

1. [Descripción](#descripción)
2. [Estructura del repositorio](#estructura-del-repositorio)
3. [Tecnologías utilizadas](#tecnologías-utilizadas)
4. [Instrucciones para ejecutar el proyecto localmente](#instrucciones-para-ejecutar-el-proyecto-localmente)
5. [Primeras pruebas con los CSV de prueba](#primeras-pruebas-con-los-csv-de-prueba)
6. [Probar la plataforma desplegada (Vercel + Render + Supabase)](#probar-la-plataforma-desplegada-vercel--render--supabase)
7. [Recorrido por las vistas](#recorrido-por-las-vistas)
8. [Pruebas automatizadas, integración y despliegue continuo](#pruebas-automatizadas-integración-y-despliegue-continuo)
9. [Integrantes del equipo con sus roles](#integrantes-del-equipo-con-sus-roles)
10. [Metodología de trabajo del equipo](#metodología-de-trabajo-del-equipo)
11. [Arquitectura de la solución](#arquitectura-de-la-solución)

---

## Descripción

Las carnicerías de gestión independiente suelen decidir qué y cuánto comprar basándose casi exclusivamente en la intuición del encargado, sin un registro sistemático de ventas ni indicadores que respalden esa decisión. Esto genera dos problemas recurrentes de alto impacto económico: **quiebre de stock** (pérdida de ventas por agotamiento prematuro de productos perecibles) y **sobreinventario/merma** (compra excesiva de carne fresca que se descompone antes de venderse).

**NexuStock** ataca ambos problemas combinando dos componentes en una sola solución:

- Un **núcleo transaccional**: productos, inventario, ventas, compras, mermas, proveedores, usuarios y roles.
- Un **motor de Machine Learning** (Random Forest, versión 1.1.0) entrenado con los datos reales de ventas, compras y mermas 2022–2024 de la carnicería piloto, **El Buen Pastor** (pyme independiente de la región de O'Higgins), que proyecta la demanda semanal por producto considerando el calendario (feriados, Fiestas Patrias, días de pago), los tiempos de entrega de los proveedores y la vida útil de la carne.

Con esa proyección el sistema genera automáticamente **sugerencias de compra** (cuánto pedir, a quién y hasta cuándo) y **alertas** con un semáforo (*Quiebre / Bajo / Óptimo*), en un dashboard pensado para que una persona sin conocimientos técnicos tome la decisión de compra con un vistazo.

- **A quién va dirigido:** dueños y encargados de carnicerías de gestión independiente, negocios pequeños sin sistemas informáticos previos.
- **Qué problema resuelve:** reemplaza el abastecimiento basado en intuición por uno apoyado en datos, reduciendo la merma por descomposición y las ventas perdidas por desabastecimiento.

### Resultados del modelo

Entrenado con 2022–2023 y evaluado con las 52 semanas de 2024 (error medio absoluto, kg por producto y semana):

| Métrica | Random Forest **1.1.0** (activo) | Random Forest 1.0.0 | Línea base |
| --- | --- | --- | --- |
| Semanas en general | 5,237 | 5,144 | 5,64 |
| Semanas con feriados | 8,933 | 8,835 | 9,80 |

La versión 1.1.0 incorpora el 18 y 19 de septiembre como días de atención: en los datos originales aparecían sin ventas y el cliente confirmó que el local sí abre esos días, por lo que se reconstruyeron.

En una simulación sobre el periodo de prueba 2024 (hecha con la versión 1.0.0), usar las sugerencias de compra reduce la merma de 6,2 % a 1,1 % y la venta perdida de 3,0 % a 2,6 %, con un ahorro anual estimado de $8.318.026 CLP. Es una simulación sobre los datos reales de El Buen Pastor, no una medición con NexuStock operando en el negocio (ver [`src ML/notebooks/04_evaluacion_impacto.ipynb`](src%20ML/notebooks/04_evaluacion_impacto.ipynb)).

---

## Estructura del repositorio

La estructura sigue el repositorio tipo de la asignatura (evidencias por fase, código fuente y máquinas virtuales):

```
NexuStock/
├── Fase 1/                     Definición del proyecto APT
│   ├── Evidencias Grupales/        guía de definición, formativa y presentación
│   └── Evidencias Individuales/    autoevaluaciones y diario de reflexión de cada integrante
├── Fase 2/                     Desarrollo del proyecto APT
│   ├── Evidencias Grupales/        guía de desarrollo e informe final
│   ├── Evidencias Individuales/    diario de reflexión de cada integrante
│   └── Evidencias Proyecto/        Documento 01 (requerimientos), Documento 02 (diseño UML), actas de avance firmadas, presentación y video
├── Fase 3/                     Presentación final
│   ├── Evidencias Grupales/        presentación final del proyecto
│   └── Evidencias Individuales/    diario de reflexión de cada integrante
├── src Frontend/               Next.js 16 (React 19, TypeScript): interfaz web y dashboard
├── src Backend/                Node.js 22 + Express 5: API REST, reglas de negocio, alertas y pruebas
├── src ML/                     Python 3.12: datos, notebooks (EDA y modelado), modelo y motor de predicción
├── Maquinas virtuales/         Docker: docker-compose, Dockerfiles, esquema SQL, .env.example y su README
├── docs/                       capturas de este README, identidad visual y mockups
└── .github/workflows/          integración continua (CI), despliegue continuo (CD) y calentado de la demo
```

Cada carpeta de código tiene su propio README con el detalle técnico: [src Backend](src%20Backend/README.md) (endpoints, roles, reglas de cálculo), [src ML](src%20ML/README.md) (modelo, contrato con el backend, validación) y [Maquinas virtuales](Maquinas%20virtuales/README.md) (Docker, puertos y variables).

---

## Tecnologías utilizadas

| Componente | Tecnología | Por qué |
| --- | --- | --- |
| Frontend | **Next.js 16 · React 19 · TypeScript** | Interfaz rápida para un dashboard con gráficos, tablas y formularios de carga; el servidor de Next reenvía `/api/*` al backend, así la cookie de sesión viaja en el mismo origen. |
| Backend | **Node.js 22 · Express 5** | API REST liviana que concentra la lógica de negocio (stock, semáforo, sugerencias, alertas), la autenticación (JWT en cookie httpOnly, bcrypt, CSRF, límite de intentos) y la orquestación del modelo. |
| Base de datos | **PostgreSQL 16** | Control transaccional del inventario: cada venta, compra o merma actualiza el stock en una transacción. Modelo v5 con 12 tablas. |
| Machine Learning | **Python 3.12 · pandas · scikit-learn (Random Forest) · joblib · Jupyter** | Análisis exploratorio, ingeniería de variables y modelo de demanda semanal. El backend lo ejecuta como proceso hijo (`predict.py --servidor`), sin un servidor Python aparte; si no responde en 2 s usa el promedio histórico. |
| Contenedores | **Docker · Docker Compose** | El mismo entorno en cualquier equipo y la misma imagen del backend en local y en la nube. |
| CI/CD | **GitHub Actions** | Lint, pruebas, validación del modelo, build y construcción de imágenes en cada push; redespliegue automático de la demo al fusionar en `main`. |
| Nube (demo) | **Vercel** (frontend) · **Render** (API + motor ML) · **Supabase** (PostgreSQL) | Planes gratuitos para la etapa demo (escenario A de la evaluación TCO). |
| Gestión | **Git / GitHub** (ramas `Features/*` y pull requests aprobados por ambos) · tablero **Kanban** | Control de versiones y seguimiento de las tareas del plan en cascada. |

---

## Instrucciones para ejecutar el proyecto localmente

El entorno local corre con Docker: PostgreSQL y el backend (API + motor ML) en contenedores, y el frontend con `npm run dev`. El detalle de cada archivo está en [Maquinas virtuales/README.md](Maquinas%20virtuales/README.md).

### Requisitos previos

- [Git](https://git-scm.com/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (abierto y con el motor corriendo)
- [Node.js 22 LTS](https://nodejs.org/) (incluye npm)
- Python **no** es necesario: la carga de datos históricos también corre en un contenedor.

### Paso 1 — Clonar el repositorio

```bash
git clone https://github.com/Blackmist02/NexuStock.git
cd NexuStock
```

### Paso 2 — Levantar la base de datos, el backend y el frontend

**Windows:** doble clic en `Maquinas virtuales/iniciar-servidor.bat`. Hace todo lo de este paso y abre el navegador.

**Cualquier sistema operativo:**

```bash
cd "Maquinas virtuales"
cp .env.example .env                 # en Windows (cmd): copy .env.example .env
docker compose up -d --build         # PostgreSQL en el puerto 5433 y API en el 4000 (la primera vez tarda unos minutos)

cd "../src Frontend"
npm install
npm run dev                          # frontend en http://localhost:3000
```

Comprobación: http://localhost:4000/api/health debe responder `{"status":"OK", ..., "database":"OK"}`.

### Paso 3 — Crear la cuenta de administrador

Abrir http://localhost:3000. La base parte vacía, así que la página lleva a **Crear cuenta**: la primera cuenta es la de administrador y pide el nombre de la carnicería. Después el registro público se cierra y el resto del equipo se crea en *Configuración → Equipo*.

![Crear la primera cuenta](docs/capturas/01-crear-cuenta.png)

Al entrar, el dashboard aparece vacío: todavía no hay productos ni movimientos.

![Dashboard vacío](docs/capturas/02-dashboard-vacio.png)

### Paso 4 — Cargar los datos históricos reales

Desde la carpeta `Maquinas virtuales`:

```bash
docker compose --profile carga run --rm carga --hasta 2024-09-22
docker compose restart backend
```

El primer comando carga el catálogo (24 productos y 15 proveedores), el calendario de eventos, el modelo de demanda 1.1.0 y las ventas, compras y mermas reales de la carnicería piloto desde el 01-01-2022 hasta el **22-09-2024** (96.998 ventas, 8.743 compras y 1.926 mermas). La primera vez tarda unos 2 minutos. Al terminar sugiere la fecha del sistema 2024-09-23.

El segundo reinicia el backend para que tome el modelo recién registrado. **No hay que saltarse este paso:** sin él, la predicción sigue usando el promedio histórico (el dashboard lo indica como «Demanda proyectada (promedio histórico)»).

> Con Python 3.12 instalado, la misma carga se puede hacer con `cd "src ML"`, `pip install -r requirements-dev.txt` y `python cargar_bd.py --hasta 2024-09-22`.

---

## Primeras pruebas con los CSV de prueba

La prueba simula el uso real de la plataforma: el sistema está en el **lunes 23-09-2024** con la historia cargada hasta el domingo anterior, y el encargado sube las ventas, compras y mermas de esa semana para obtener la proyección y las sugerencias de compra de la semana siguiente.

Los tres archivos de prueba están versionados en [`src ML/data/plantillas/`](src%20ML/data/plantillas/), en el mismo formato que las plantillas que descarga la plataforma (separador `;` y coma decimal, como los guarda Excel):

| Archivo | Contenido (23 al 29-09-2024) |
| --- | --- |
| `ventas_2024-09-23_2024-09-29.csv` | 617 ventas (727 kg) · `fecha;hora;producto;cantidad;precio_unitario_clp` |
| `compras_2024-09-23_2024-09-29.csv` | 57 compras (828,1 kg) · `fecha;hora;producto;cantidad;costo_unitario_clp;proveedor` |
| `mermas_2024-09-23_2024-09-29.csv` | 12 mermas (77,7 kg) · `fecha;hora;producto;cantidad;motivo;costo_unitario_clp` |

### Prueba 1 — Fijar la fecha del sistema

En **Configuración → Fecha del sistema**, elegir `23-09-2024` y presionar *Guardar fecha*. Como los datos son históricos, «hoy» en NexuStock es una fecha de referencia (se ve en la barra lateral y arriba a la derecha con la etiqueta `ref.`).

### Prueba 2 — Cargar la semana por CSV

En **Configuración → Carga de datos (CSV)**:

1. Presionar **Elegir archivo** en cada fila (ventas, compras y mermas) y seleccionar el CSV correspondiente. Cada fila muestra el nombre y tamaño del archivo elegido; *Plantilla* descarga el formato vacío.
2. En *Cargar hasta (incluido)* elegir `29-09-2024`, o presionar el atajo **1 semana** (cuenta desde el día siguiente al último cargado), y dejar marcado **Mover la fecha del sistema al día siguiente de la carga**.
3. Presionar **Revisar archivos**. La plataforma valida los archivos sin guardar nada y muestra qué va a importar:

![Revisión de la carga de CSV](docs/capturas/04-carga-csv.png)

4. Presionar **Importar 686 movimientos**. Todo se aplica en una sola transacción (si algo falla no se guarda nada) y la fecha del sistema pasa al **30-09-2024**.

Resultado esperado: 617 ventas, 57 compras y 12 mermas importadas, stock actualizado de los 24 productos y alertas recalculadas. Subir los mismos archivos otra vez no duplica nada: solo se importa lo posterior a lo ya cargado.

### Prueba 3 — Revisar la proyección y las sugerencias

- **Dashboard:** valor del inventario, productos en quiebre y con stock bajo, tendencia real vs. proyectada (*Demanda proyectada (modelo de ML)*), semáforo y sugerencias de compra con proveedor y fecha límite para pedir.
- **Predicción → Demanda y alertas:** debe indicar *«Proyección con el modelo RandomForestRegressor 1.1.0»*, con la venta real, las predicciones registradas de las semanas pasadas y la proyección desde la semana del 30-09.
- **Predicción → Precisión del modelo:** MAE del modelo en operación.
- **Alertas:** atender o descartar una alerta (solo administrador).
- **Registrar venta / Registrar compra** (botones del dashboard, del inventario y del detalle de cada producto): registrar un movimiento a mano y ver cómo cambia el stock y el semáforo del producto.

![Predicción con el modelo 1.1.0](docs/capturas/15-prediccion.png)

### Repetir la prueba

En **Configuración → Carga de datos → Deshacer movimientos desde una fecha**, elegir `23-09-2024`, presionar *Revisar* y luego *Deshacer 686 movimientos*. Se borran los movimientos de esa semana, el stock vuelve a como estaba y la fecha del sistema regresa al 23-09-2024; después se pueden volver a subir los mismos archivos.

![Deshacer movimientos desde una fecha](docs/capturas/06-deshacer-revision.png)

Para empezar completamente de cero: `docker compose down -v` en `Maquinas virtuales` (borra la base local) y volver al paso 2.

---

## Probar la plataforma desplegada (Vercel + Render + Supabase)

La misma versión está publicada en servicios gratuitos para la evaluación:

| Componente | Servicio | URL |
| --- | --- | --- |
| Frontend | Vercel | https://nexustock-omega.vercel.app |
| API + motor ML | Render (Docker, región Virginia) | https://nexustock-api.onrender.com/api/health |
| Base de datos | Supabase (PostgreSQL, us-east-1) | sin acceso público (RLS activo, solo la API se conecta) |

La demo tiene cargados los datos reales hasta septiembre de 2024 y el modelo 1.1.0 activo, con la fecha del sistema a fines de septiembre de 2024. También tiene una página pública de presentación sin iniciar sesión: https://nexustock-omega.vercel.app/conoce

### Credenciales de acceso para la evaluación

Para probar todas las funcionalidades se usa la cuenta de **administrador de la plataforma** (`admin@nexustock.cl`). **Su contraseña no se publica en este repositorio**: el repositorio es público y la cuenta de administrador puede borrar datos, crear usuarios y cambiar contraseñas. Las credenciales se entregan directamente al docente y a la comisión evaluadora junto con la entrega del proyecto. Si no las tienes, pídelas al equipo (Manuel Bustamante o Ignacio Mella).

La demo también tiene cuentas por rol para revisar los permisos (*Dueño*, *TI* y *Usuario/operador*); se entregan por el mismo canal.

### Antes de empezar

Render Free apaga el backend después de 15 minutos sin uso. La primera petición puede tardar hasta **1 minuto** mientras despierta; si el login no responde, esperar y reintentar. Antes de una presentación, el equipo ejecuta *Actions → Calentar demo*. El inicio de sesión tarda unos 2–3 s (el cifrado de contraseñas usa bcrypt con costo 12 en una CPU compartida: desviación aceptada para la demo).

### Aplicar las mismas pruebas en la demo

Los CSV son los mismos de [`src ML/data/plantillas/`](src%20ML/data/plantillas/) (descargarlos desde GitHub con *Download raw file*).

1. Entrar en https://nexustock-omega.vercel.app/login con la cuenta de administrador.
2. **Configuración → Carga de datos → Deshacer movimientos desde una fecha:** elegir `23-09-2024`, *Revisar* y *Deshacer*. La demo ya tiene esa semana cargada; esto la quita y deja la fecha del sistema en el 23-09-2024.
3. Seguir la [Prueba 2](#prueba-2--cargar-la-semana-por-csv) y la [Prueba 3](#prueba-3--revisar-la-proyección-y-las-sugerencias) con los tres archivos: *Revisar archivos* → *Importar* → revisar dashboard, predicción y alertas.

Al terminar, los movimientos y el stock de la demo quedan iguales que antes (la semana se borra y se vuelve a cargar con los mismos archivos) y la fecha del sistema queda en el 30-09-2024. Mientras se hace la prueba, cualquier otra persona conectada ve los cambios.

Otras pruebas útiles en la demo:

- **Roles:** con las cuentas por rol, comprobar que un operador puede registrar ventas y compras pero no cambiar la configuración ni atender alertas, y que TI puede registrar modelos pero no cargar CSV (tabla completa en *Configuración → Permisos por rol*).
- **Recuperar contraseña:** la demo no tiene servidor de correo; la pantalla indica pedir un *Enlace de acceso* al administrador TI, que lo genera con el botón *Enlace de acceso* de cada usuario en *Configuración → Equipo*.
- **Panel de la API:** https://nexustock-api.onrender.com/api/health abierto en el navegador (con sesión de administrador o TI) muestra el estado de la API, la base y el motor ML, una consola para probar endpoints y pruebas rápidas de seguridad.

---

## Recorrido por las vistas

Capturas tomadas en un entorno local recién levantado con los pasos de este README (fecha del sistema 30-09-2024, después de la carga de prueba).

### En el celular

La interfaz se adapta al teléfono: barra superior con el menú, el logo y el cambio de tema; encabezados con la búsqueda a todo el ancho y los botones en grilla; y las tablas pasan a ser **tarjetas** (una por fila, con el nombre de cada dato sobre su valor), para leer todo sin desplazarse hacia los lados. En tableta y computador se mantiene el formato de tabla.

![NexuStock en el celular: dashboard, inventario en tarjetas, predicción y carga de datos](docs/capturas/20-movil.png)

### En el computador

| Vista | Captura |
| --- | --- |
| **Inicio de sesión** — acceso con correo y contraseña, tema oscuro o crema. | ![Login](docs/capturas/00-login.png) |
| **Recuperar contraseña** — enlace de un solo uso por correo; sin servidor de correo, indica pedir un enlace al TI. | ![Recuperar contraseña](docs/capturas/07-recuperar-contrasena.png) |
| **Conoce NexuStock** — página pública de presentación (sin iniciar sesión). | ![Conoce](docs/capturas/08-conoce.png) |
| **Dashboard** — KPIs, tendencia real vs. proyectada, semáforo y sugerencias de compra. | ![Dashboard](docs/capturas/10-dashboard.png) |
| **Inventario** — stock, nivel (Quiebre/Bajo/Óptimo), filtros, exportación y registro de ventas y compras. | ![Inventario](docs/capturas/11-inventario.png) |
| **Detalle de producto** — serie de 30 días, movimientos y sugerencia de compra. | ![Detalle de producto](docs/capturas/12-detalle-producto.png) |
| **Proveedores** — lead time y días hábiles de entrega (base de la fecha límite para pedir). | ![Proveedores](docs/capturas/13-proveedores.png) |
| **Alertas** — alertas activas e historial; atender o descartar. | ![Alertas](docs/capturas/14-alertas.png) |
| **Predicción** — demanda real, predicciones registradas y proyección hasta 4 meses, por total, categoría o producto. | ![Predicción](docs/capturas/15-prediccion.png) |
| **Calendario** — feriados y eventos que usa el modelo (Fiestas Patrias, Semana Santa, propios). | ![Calendario](docs/capturas/16-calendario.png) |
| **Precisión del modelo** — MAE en operación y versiones del modelo (registro y activación: rol TI). | ![Precisión del modelo](docs/capturas/17-precision-modelo.png) |
| **Historial** — movimientos, totales y ventas por semana, con exportación a CSV. | ![Historial](docs/capturas/18-historial.png) |
| **Configuración** — negocio, alertas, fecha del sistema, carga de datos, equipo y permisos por rol. | ![Configuración](docs/capturas/19-configuracion.png) |

---

## Pruebas automatizadas, integración y despliegue continuo

**Pruebas locales:**

```bash
cd "src Backend"
npm install
npm test                             # reglas de negocio y utilidades (sin base de datos)
# + API completa contra PostgreSQL (la base debe terminar en _test; se borra y recrea):
#   docker compose exec db psql -U nexustock -c "CREATE DATABASE nexustock_test"   (desde «Maquinas virtuales»)
#   TEST_DATABASE_URL=postgres://nexustock:nexustock_dev@localhost:5433/nexustock_test npm test

cd "../src ML"
pip install -r requirements.txt
python tests/validar_predict.py      # predict.py reproduce las predicciones del notebook 03 → «Resultado: OK»
```

Las pruebas de sistema contra la demo (seguridad, rendimiento, fallas del motor) y su informe están en [src Backend/test/sistema](src%20Backend/test/sistema/).

**GitHub Actions** ([.github/workflows](.github/workflows/)):

| Workflow | Cuándo corre | Qué hace |
| --- | --- | --- |
| **CI** ([ci.yml](.github/workflows/ci.yml)) | Cada push a `main` o `Features/*` y cada pull request a `main` | Backend: ESLint y pruebas unitarias y de API contra un PostgreSQL 16 descartable. Motor ML: `validar_predict.py`. Frontend: `tsc`, ESLint y `next build`. Luego construye las imágenes Docker de producción del backend y del frontend. |
| **CD** ([cd.yml](.github/workflows/cd.yml)) | Cuando CI termina en verde sobre `main`, o a mano | Redespliega la demo: backend en Render (deploy hook) y frontend en Vercel (CLI desde `src Frontend`, con los secretos `VERCEL_*`; sin ellos se publica a mano, ver [Maquinas virtuales](Maquinas%20virtuales/README.md#imágenes-de-producción)), y prueba `/api/health` en la URL pública. |
| **Calentar demo** ([demo-calentar.yml](.github/workflows/demo-calentar.yml)) | A mano, antes de presentar | Despierta el backend de Render Free. |

**Alcance del despliegue** (acta del 16-11-2026): el proyecto llega hasta la etapa demo en servicios gratuitos. La implementación con un proveedor cloud (Azure Chile Central según la evaluación TCO, con publicación de imágenes en GHCR) requiere inversión y queda como fase futura; esa versión de `cd.yml` está en el historial (commit `48b15f6`).

---

## Integrantes del equipo con sus roles

| Integrante | Rol | Responsabilidades principales |
| --- | --- | --- |
| **Ignacio Mella** | Software Engineer | Arquitectura del sistema, diseño y administración de la base de datos SQL, lógica de backend del motor de movimientos e inventario, construcción de las APIs, seguridad y despliegue en la nube. |
| **Manuel Bustamante** | Data Scientist | Limpieza y procesamiento de los datos históricos, análisis exploratorio (EDA), modelamiento predictivo de demanda, evaluación de la precisión (MAE), integración del motor ML con el backend y desarrollo del frontend/dashboard. |

Las tareas de integración (motor de reglas, despliegue, pruebas de sistema, capacitación y pruebas de aceptación) se trabajaron en conjunto.

---

## Metodología de trabajo del equipo

El proyecto partió con una planificación ágil (Scrum) en la Fase 1 y en la Fase 2 se replanificó a una metodología **en cascada**, más adecuada a un alcance acotado, a entregables documentales formales y a la validación con la carnicería piloto. Cada etapa se cierra con su entregable aprobado antes de pasar a la siguiente, y cualquier cambio de alcance pasa por un **control de cambios** registrado en acta.

| Etapa | Entregables principales |
| --- | --- |
| 1. Requerimientos | Documento 01 — Especificación de requerimientos (ERS) en cascada. |
| 2. Diseño | Documento 02 — Diseño UML (arquitectura, casos de uso, modelo de datos v5, despliegue). |
| 3. Construcción | Base de datos, API, motor ML (EDA, variables, modelo 1.0.0 → 1.1.0), frontend e integración. |
| 4. Pruebas | Pruebas unitarias y de API (CI), pruebas de integración y de sistema en la demo, corrección de defectos. |
| 5. Despliegue | Entorno demo (Vercel + Render + Supabase) con CI/CD; evaluación económica (TCO, VAN, TIR) para la etapa productiva. |
| 6. Gestión del cambio y cierre | Capacitación por rol, pruebas de aceptación (UAT) y de usabilidad, documentación y entrega final. |

**Seguimiento:** tablero Kanban con las tareas del plan por etapa (responsable, prioridad, fechas y dependencias) y actas de control de avance revisadas por el docente ([Fase 2/Evidencias Proyecto](Fase%202/Evidencias%20Proyecto/)).

**Flujo de trabajo en GitHub:** cada integrante trabaja en su rama (`Features/Manuel`, `Features/Ignacio`); a `main` solo se integra por *pull request* aprobado por ambos y con la CI en verde. Cada fusión en `main` redespliega la demo.

---

## Arquitectura de la solución

NexuStock separa responsabilidades en capas. El frontend nunca accede directamente al motor de Machine Learning ni a la base de datos: todo pasa por el backend, que actúa como orquestador central.

```mermaid
flowchart LR
    subgraph Navegador
        U["Usuario<br/>(administrador, operador, TI)"]
    end

    subgraph Vercel["Vercel — src Frontend"]
        FE["Next.js 16<br/>vistas + proxy /api/*"]
    end

    subgraph Render["Render — contenedor Docker (Maquinas virtuales/backend/Dockerfile)"]
        BE["API REST<br/>Node.js 22 / Express 5<br/>auth, reglas, alertas"]
        ML["Motor ML — src ML<br/>Python 3.12, predict.py<br/>Random Forest 1.1.0"]
    end

    subgraph Supabase
        DB[("PostgreSQL 16<br/>modelo v5, 12 tablas")]
    end

    U -- HTTPS --> FE
    FE -- "/api/* (cookie de sesión)" --> BE
    BE -- "stdin/stdout JSON<br/>(proceso hijo)" --> ML
    BE -- "SQL con TLS" --> DB
```

En local es la misma arquitectura: el frontend corre con `npm run dev` y la API, el motor y PostgreSQL en los contenedores de `Maquinas virtuales/docker-compose.yml`.

**Flujo de una predicción:**

1. El **frontend** pide el dashboard o la predicción a la API (`/api/dashboard`, `/api/predictions/...`).
2. El **backend** arma las ventas semanales de las 8 semanas previas por producto y los eventos del calendario, y se los envía al **motor ML**, que mantiene el modelo cargado en memoria y responde en unos 50 ms.
3. Si el motor no está listo, falla o tarda más de 2 s, se usa el **promedio histórico** del producto o de su categoría (respaldo, RF-11).
4. El backend compara la demanda proyectada con el stock mediante una **capa de reglas** (margen de seguridad, vida útil, lead time y días hábiles del proveedor) y clasifica cada producto en *Quiebre*, *Bajo* u *Óptimo*, con la cantidad sugerida y la fecha límite para pedir.
5. Las predicciones se registran en la base para medir después el error real del modelo (MAE en operación).

**Modelo de datos (12 tablas):** `usuarios`, `categorias`, `proveedores`, `productos`, `compras`, `ventas`, `mermas`, `eventos_calendario`, `modelos_ml`, `predicciones`, `alertas_inventario` y `configuracion`. El esquema completo está en [Maquinas virtuales/init.sql](Maquinas%20virtuales/init.sql) y el diseño en el Documento 02 de la Fase 2.
