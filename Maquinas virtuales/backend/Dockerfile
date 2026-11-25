# ---- Backend NexuStock: API Express (Node.js 22) + Motor ML (Python 3.12) en un mismo contenedor ----
# Contexto de construcción: la RAÍZ del repositorio (lo define ../docker-compose.yml), para incluir «src Backend»,
# «src ML» y los certificados de «Maquinas virtuales/certs». Archivos que entran a la imagen: Dockerfile.dockerignore.
#   docker build -f "Maquinas virtuales/backend/Dockerfile" --target prod -t nexustock-backend .
# Dentro de la imagen el motor queda en /ml-engine (ML_ENGINE_DIR) y la API en /app.

FROM node:22-bookworm-slim AS node

FROM python:3.12-slim-bookworm AS base
# Node.js 22 copiado desde la imagen oficial (Debian bookworm trae Python 3.11; el ERS exige 3.12)
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
# Ruta del motor dentro de la imagen. Fuera de Docker, config.js usa «../../src ML»; aquí el motor vive en /ml-engine,
# así que la imagen la define sola y no depende de que el servicio (Render, compose) declare ML_ENGINE_DIR.
ENV ML_ENGINE_DIR=/ml-engine
# Dependencias del motor ML. scikit-learn va fijo: debe ser la versión con la que se serializó el modelo.
COPY ["src ML/requirements.txt", "/ml-engine/requirements.txt"]
RUN pip install -r /ml-engine/requirements.txt
WORKDIR /app
COPY ["src Backend/package.json", "src Backend/package-lock.json", "./"]

# ---- Desarrollo (nodemon; «src Backend» y «src ML» se montan como volúmenes) ----
FROM base AS dev
ENV NODE_ENV=development
RUN npm ci
COPY ["src Backend/", "."]
EXPOSE 4000
CMD ["npm", "run", "dev"]

# ---- Producción ----
FROM base AS prod
ENV NODE_ENV=production
RUN npm ci --omit=dev && npm cache clean --force
COPY ["src Backend/", "."]
COPY ["src ML/predict.py", "/ml-engine/predict.py"]
COPY ["src ML/models/", "/ml-engine/models/"]
# CA pública de Supabase para DB_SSL=verificado (DB_SSL_CA=/certs/prod-ca-2021.crt)
COPY ["Maquinas virtuales/certs/", "/certs/"]
RUN useradd --system --uid 1001 --home-dir /app nexustock && chown -R nexustock /app
USER nexustock
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "src/app.js"]
