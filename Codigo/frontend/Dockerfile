# ---- Frontend NexuStock: Next.js 16 (salida standalone) ----
# Contexto de construcción: Codigo/frontend. La URL de la API se lee al ejecutar (API_URL), no al compilar:
# la misma imagen sirve en desarrollo y en producción, cambiando solo variables de entorno (RNF-25).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS prod
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN useradd --system --uid 1001 nexustock
COPY --from=build --chown=nexustock /app/public ./public
COPY --from=build --chown=nexustock /app/.next/standalone ./
COPY --from=build --chown=nexustock /app/.next/static ./.next/static
USER nexustock
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/login').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
