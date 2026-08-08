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
# runtime necesita el schema y las migraciones.
COPY --from=builder --chown=monkey:nodejs /app/prisma ./prisma

# ── El CLI de Prisma, aparte ─────────────────────────────────────────────────
#
# NO se copia `node_modules/prisma` del builder: el CLI de Prisma 7 depende de
# @prisma/config y @prisma/engines, que con el layout de pnpm viven fuera de esa
# carpeta. Copiarla sola deja un CLI que revienta con MODULE_NOT_FOUND en el
# primer arranque — y en un orquestador eso es un bucle de reinicio.
#
# Se instala con npm en un prefijo propio para que resuelva su árbol completo y
# para que no pueda tocar el node_modules del bundle standalone, que Next armó
# con un trace exacto.
# `openssl` no viene en bookworm-slim y el motor de esquema lo busca: sin él
# avisa que no detecta la versión de libssl y cae a un binario de reserva.
# Funciona igual, pero un aviso en cada arranque de producción es ruido que
# tapa los avisos que sí importan.
ARG PRISMA_VERSION=7.9.1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/* \
 && npm install --global --no-fund --no-audit prisma@${PRISMA_VERSION} \
 && npm cache clean --force

# El CLI arrastra Studio y drivers de otras bases que `migrate deploy` nunca
# usa, y son ~250 MB. NO se pueden borrar: el CLI hace `require` de
# `@prisma/studio-core/data/bff` al arrancar, pase lo que pase, y el contenedor
# entra en bucle de reinicio. Probado.
#
# El precio es una imagen de ~790 MB en vez de ~470. Se paga a cambio de que el
# esquema se migre solo al desplegar, que es lo que evita el error de operación
# más caro que hay: servir tráfico contra una base desactualizada.

# Config mínima para el CLI. La del repo es TypeScript e importa `dotenv`, que
# en el runtime no está: acá las variables ya vienen del entorno del contenedor.
COPY --chown=monkey:nodejs <<'EOF' /app/prisma.config.js
const path = require("node:path");

module.exports = {
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  migrations: { path: path.join(__dirname, "prisma", "migrations") },
  datasource: { url: process.env.DATABASE_URL ?? "" },
};
EOF

# Adjuntos con STORAGE_DRIVER=local (Fase 3). Montar como volumen.
RUN mkdir -p /app/var/uploads && chown -R monkey:nodejs /app/var

USER monkey
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Las migraciones se aplican ANTES de servir tráfico, y van en la imagen y no en
# el `command` del compose a propósito: así la imagen se basta sola en cualquier
# orquestador —EasyPanel, Swarm, Kubernetes— sin depender de que alguien acierte
# a sobrescribir el comando de arranque.
#
# `migrate deploy` solo aplica migraciones ya versionadas: nunca genera ni
# infiere nada. Y toma un lock de Postgres, así que dos réplicas arrancando a la
# vez no se pisan.
CMD ["sh", "-c", "prisma migrate deploy && exec node server.js"]
