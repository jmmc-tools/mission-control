# syntax=docker/dockerfile:1.7
# ── Stage 0: extraer binario openclaw desde su imagen oficial ──
FROM ghcr.io/openclaw/openclaw:latest AS openclaw-bin

# ── Stage 1: deps ──────────────────────────────────────────────
FROM node:22.22.0-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
# better-sqlite3 necesita compilación nativa — solo en build, no en runtime
RUN apt-get update && \
    apt-get install -y python3 make g++ --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile

# ── Stage 2: build ─────────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ── Stage 3: runtime hardened ──────────────────────────────────
FROM node:22.22.0-slim AS runtime

LABEL org.opencontainers.image.source="https://github.com/builderz-labs/mission-control"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# ❌ ELIMINADO del oficial: curl, git, python3, make, g++, procps
# En AKS no queremos que MC pueda instalar agentes ni compilar nada
# Solo ca-certificates para TLS saliente hacia el gateway
RUN apt-get update && \
    apt-get install -y ca-certificates --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copiar solo los artefactos de Next.js standalone
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/src/lib/schema.sql ./src/lib/schema.sql

# ❌ ELIMINADO: node-pty (terminal PTY — no necesario para POC)
# Si en el futuro necesitas la feature de terminal, añádelo aquí

# SQLite data directory + home para el usuario nextjs (evita /nonexistent)
RUN mkdir -p .data /home/nextjs && chown -R nextjs:nodejs .data /home/nextjs

# OpenClaw CLI — copiado desde la imagen openclaw en lugar de npm install
# El binario usa import.meta.url para resolver dist/ relativo a sí mismo:
#   new URL("./dist/entry.mjs", import.meta.url)  → /usr/local/bin/dist/entry.mjs
# Por tanto copiamos el binario Y su dist/ al mismo directorio padre.
COPY --from=openclaw-bin /usr/local/bin/openclaw /usr/local/bin/openclaw
COPY --from=openclaw-bin /app/dist /usr/local/bin/dist
COPY --from=openclaw-bin /app/node_modules /usr/local/bin/node_modules
COPY --from=openclaw-bin /app/package.json /usr/local/bin/package.json

# Healthcheck sin curl
RUN echo 'const http=require("http");const r=http.get("http://localhost:"+(process.env.PORT||3000)+"/api/status?action=health",s=>{process.exit(s.statusCode===200?0:1)});r.on("error",()=>process.exit(1));r.setTimeout(4000,()=>{r.destroy();process.exit(1)})' \
    > /app/healthcheck.js

USER nextjs
ENV HOME=/home/nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "/app/healthcheck.js"]

CMD ["node", "server.js"]