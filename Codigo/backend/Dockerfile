# ---- Backend NexuStock (Node.js / Express) ----
FROM node:22-alpine AS base
WORKDIR /app

# Motor predictivo (opcional): el backend ejecuta ml-engine/predict.py con Python. Sin Python, o sin modelo activo,
# el sistema usa el promedio histórico (RF-11). Para habilitarlo: WITH_PYTHON=true y, si el modelo lo necesita,
# ML_PIP_PACKAGES="scikit-learn joblib pandas" (variables de .env; ver ml-engine/README.md).
ARG WITH_PYTHON=false
ARG ML_PIP_PACKAGES=""
RUN if [ "$WITH_PYTHON" = "true" ]; then \
      apk add --no-cache python3 py3-pip && \
      if [ -n "$ML_PIP_PACKAGES" ]; then pip install --no-cache-dir --break-system-packages $ML_PIP_PACKAGES; fi; \
    fi

# Instalar dependencias primero para aprovechar la caché de capas
COPY package*.json ./

# ---- Desarrollo (con nodemon y hot-reload) ----
FROM base AS dev
ENV NODE_ENV=development
RUN npm ci
COPY . .
EXPOSE 4000
CMD ["npm", "run", "dev"]

# ---- Producción ----
FROM base AS prod
ENV NODE_ENV=production
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node . .
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1
CMD ["node", "src/app.js"]
