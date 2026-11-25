# Maquinas virtuales — Docker y configuración para correr NexuStock en local

En esta carpeta está todo lo necesario para levantar NexuStock en un equipo propio con **Docker**: la base de datos
PostgreSQL, el backend (API Express + motor de Machine Learning en Python) y las imágenes de producción. El código
fuente vive en las carpetas hermanas `src Backend`, `src ML` y `src Frontend`.

| Archivo / carpeta | Para qué sirve |
| --- | --- |
| `docker-compose.yml` | Servicios locales: `db` (PostgreSQL 16), `backend` (API + motor ML) y `carga` (carga los datos históricos, a pedido). |
| `iniciar-servidor.bat` | Windows: levanta todo con doble clic (Docker + frontend) y abre el navegador. |
| `.env.example` | Plantilla de variables de entorno. Se copia a `.env` (el `.env` nunca se sube al repositorio). |
| `backend/Dockerfile` | Imagen del backend: Node.js 22 + Python 3.12 con el modelo. Etapa `dev` (local) y `prod` (Render). |
| `backend/Dockerfile.dockerignore` | Qué archivos entran a la imagen del backend (se construye desde la raíz del repositorio). |
| `frontend/Dockerfile` | Imagen de producción del frontend Next.js (salida *standalone*). |
| `frontend/Dockerfile.dockerignore` | Qué archivos entran a la imagen del frontend. |
| `init.sql` | Esquema completo de la base (modelo v5, 12 tablas). Se ejecuta solo al crear la base por primera vez. |
| `migracion_v5.sql` | Actualiza una base del modelo v4 al v5 (agrega CONFIGURACION y MERMAS). |
| `supabase_seguridad.sql` | Cierra la Data API pública de Supabase (RLS en todas las tablas). Solo para la base en la nube. |
| `certs/prod-ca-2021.crt` | Certificado público de la CA de Supabase, para conectar con TLS verificado. |

## Requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) corriendo.
- [Node.js 22 LTS](https://nodejs.org/) para el frontend en modo desarrollo.
- Python **no** es necesario: la carga de datos también corre en un contenedor.

## Levantar el entorno

**Windows (lo más simple):** doble clic en `iniciar-servidor.bat`. Crea el `.env` si no existe, inicia Docker Desktop,
levanta la base y el backend, instala las dependencias del frontend la primera vez, lo inicia en una ventana aparte y
abre `http://localhost:3000`.

**A mano (Windows, macOS o Linux):**

```bash
cd "Maquinas virtuales"
cp .env.example .env                 # en Windows (cmd): copy .env.example .env
docker compose up -d --build         # base (puerto 5433) + backend (puerto 4000)

cd "../src Frontend"
npm install
npm run dev                          # http://localhost:3000
```

La primera construcción tarda unos minutos (instala Node, Python, pandas y scikit-learn). Para comprobar el backend:
`http://localhost:4000/api/health` debe responder `"status":"OK"` y `"database":"OK"`.

## Cargar los datos históricos reales

La base parte vacía. Primero se crea la cuenta de administrador desde la página (*Crear cuenta*), porque los datos
históricos se registran a su nombre. Después:

```bash
cd "Maquinas virtuales"
docker compose --profile carga run --rm carga --hasta 2024-09-22
docker compose restart backend       # el backend toma el modelo 1.1.0 que se acaba de registrar
```

Carga el catálogo (24 productos, 15 proveedores), el calendario de eventos, el modelo de demanda y las ventas, compras y
mermas reales de la carnicería piloto desde 2022 hasta el 22-09-2024. La primera vez tarda unos 2 minutos (descarga las
dependencias de Python; quedan en caché para las siguientes). Sin el `restart`, el backend sigue usando el promedio
histórico hasta que se reinicie.

Con Python 3.12 instalado también se puede correr directo: `cd "src ML"`, `pip install -r requirements-dev.txt` y
`python cargar_bd.py --hasta 2024-09-22` (lee la conexión de este `.env`).

## Puertos y variables

| Variable (`.env`) | Por defecto | Uso |
| --- | --- | --- |
| `DB_PORT` | 5433 | PostgreSQL expuesto en el equipo (usuario y clave: `POSTGRES_USER` / `POSTGRES_PASSWORD`). |
| `BACKEND_PORT` | 4000 | API. El frontend en desarrollo le reenvía `/api/*` (variable `API_URL` del frontend). |
| `FRONTEND_PORT` | 3000 | Lo usan `iniciar-servidor.bat` y el CORS del backend. |
| `FECHA_REFERENCIA` | vacío | «Hoy» del sistema para trabajar con datos históricos (también se cambia en *Configuración*). |
| `BACKEND_DATABASE_URL`, `DB_SSL` | vacío | Para apuntar el backend local a Supabase en vez de la base local. |

El resto de variables está explicado en `.env.example`.

## Comandos útiles

```bash
docker compose ps                    # estado de los contenedores
docker compose logs -f backend       # log del backend (ahí aparece el enlace de recuperación de contraseña sin SMTP)
docker compose down                  # apagar (los datos se conservan en el volumen nexustock_pgdata)
docker compose down -v               # apagar y BORRAR la base local para empezar de cero
```

## Imágenes de producción

Se construyen igual que en la integración continua y en Render (desde la raíz del repositorio):

```bash
docker build -f "Maquinas virtuales/backend/Dockerfile" --target prod -t nexustock-backend .
docker build -f "Maquinas virtuales/frontend/Dockerfile" -t nexustock-frontend "src Frontend"
docker run -p 3000:3000 -e API_URL=http://host.docker.internal:4000 nexustock-frontend
```

En Render, el servicio `nexustock-api` usa *Dockerfile Path* `./Maquinas virtuales/backend/Dockerfile` y
*Docker Build Context Directory* `.` (raíz). En Vercel, el *Root Directory* del proyecto es `src Frontend`.
