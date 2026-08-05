# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────────────────
# Monkey — build multi-stage para VPS
#
# Notas de decisión:
#  · bookworm-slim (glibc), no alpine. @node-rs/argon2 trae binarios precompilados
#    para ambos, pero glibc evita sorpresas con cualquier otra dependencia nativa.
#  · Prisma 7 ya no lleva engine de Rust, así que no hay binarios de engine que
#    hacer coincidir entre el builder y el runtime — solo se copia el cliente
#    TypeScript generado, que va dentro del bundle de Next.
#  · output: "standalone" en next.config.ts hace el trace de node_modules; la
#    imagen final no lleva ni pnpm ni las devDependencies.
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=24-bookworm-slim

# ── Stage 1: dependencias ────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# pnpm-workspace.yaml lleva el allowBuilds: sin él, pnpm bloquea los scripts
# de instalación de prisma/esbuild/sharp y el install falla.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── Stage 2: build ───────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# En build time no hay base de datos ni secretos. El entorno real se valida al
# arrancar (src/instrumentation.ts), que es cuando de verdad importa.
ENV SKIP_ENV_VALIDATION=true
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm prisma generate
RUN pnpm next build

# El Service Worker se construye DESPUÉS de Next y en un paso aparte (modo
# configurador de Serwist, ver serwist.config.ts): el manifiesto de precarga se
# arma leyendo los archivos hasheados que dejó el build. Escribe public/sw.js,
# que la etapa de runtime copia junto con el resto de `public/`.
RUN pnpm serwist build serwist.config.ts

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs monkey

COPY --from=builder --chown=monkey:nodejs /app/.next/standalone ./
COPY --from=builder --chown=monkey:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=monkey:nodejs /app/public ./public

# `prisma migrate deploy` corre en el arranque del contenedor, así que el
# runtime necesita el CLI y el schema. Es lo único que sobrevive del builder
# además del bundle.
COPY --from=builder --chown=monkey:nodejs /app/prisma ./prisma
COPY --from=builder --chown=monkey:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=monkey:nodejs /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

# Adjuntos con STORAGE_DRIVER=local (Fase 3). Montar como volumen.
RUN mkdir -p /app/var/uploads && chown -R monkey:nodejs /app/var

USER monkey
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
