# ---- Backend NexuStock (Node.js / Express) ----
FROM node:22-alpine AS base
WORKDIR /app

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
