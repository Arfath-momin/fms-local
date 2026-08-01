# syntax=docker/dockerfile:1

# Prisma 7 with the driver adapter generates a pure-TypeScript client compiled
# into the app bundle — there is no query-engine binary, so no binaryTargets and
# no musl/OpenSSL handling is needed here.

FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# `prisma generate` runs in postinstall and only needs a parseable URL, never a
# reachable database. Runtime values come from compose.
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder


# ---- dependencies -----------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci


# ---- build ------------------------------------------------------------------
# Also serves as the image for the one-shot `migrate` and `seed` services: it is
# the only stage with the Prisma CLI, tsx, and the migration files together.
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build


# ---- migration toolchain ----------------------------------------------------
# Platforms that run one container per service (Railway) have no equivalent of
# compose's one-shot `migrate` service, so the app container has to apply its
# own migrations at startup. The traced `node_modules` in .next/standalone
# contains no Prisma CLI — it is a devDependency the compiled server never
# imports — and `npx prisma` cannot fetch one at runtime as an unprivileged
# user. So vendor a self-contained CLI here instead.
#
# Installed into its own prefix, never merged into the runtime node_modules:
# overlaying these would silently replace the exact @prisma/client build that
# `next build` traced. Versions are read out of the lockfile so this can never
# drift from what the app itself was built against. `typescript` is an optional
# peer of the CLI, needed only to load the TypeScript prisma.config.ts.
FROM base AS migrator
WORKDIR /migrate
COPY package-lock.json ./lock.json
RUN npm install --no-save --no-audit --no-fund --no-package-lock \
      "prisma@$(node -p "require('./lock.json').packages['node_modules/prisma'].version")" \
      "dotenv@$(node -p "require('./lock.json').packages['node_modules/dotenv'].version")" \
      "typescript@$(node -p "require('./lock.json').packages['node_modules/typescript'].version")" \
 && rm lock.json


# ---- runtime ----------------------------------------------------------------
FROM base AS runner
# UPLOADS_DIR is deliberately NOT set here. src/lib/attachments.ts falls back to
# RAILWAY_VOLUME_MOUNT_PATH and only then to a relative "uploads", which
# resolves against WORKDIR to the same /app/uploads this used to hardcode.
# Setting it would win over the ?? chain and strand every bill image on the
# container filesystem, where a redeploy takes it with it.
#
# The base stage's placeholder DATABASE_URL is blanked so it cannot be inherited
# into production. Left in place, a deployment that simply forgot to wire up its
# database would start clean and then fail deep inside the connection pool
# against localhost; empty, it fails immediately and says so.
#
# HOSTNAME is what Next's standalone server binds — it reads process.env.HOSTNAME
# and falls back to 0.0.0.0. That default is right for compose, where Caddy
# reaches the app over IPv4. Railway needs IPv6 and cannot rely on this value
# anyway: container runtimes set HOSTNAME to the container's own name and a
# platform-injected value beats the image's, so scripts/start-prod.sh pins the
# bind address there instead of trusting whatever arrives in the environment.
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=

# su-exec drops privileges without the signal-forwarding and reaping problems
# `su` brings: it execs into the target user in the same PID, so the server
# stays PID 1 and still receives SIGTERM on shutdown.
RUN apk add --no-cache su-exec \
 && addgroup -g 1001 -S nodejs \
 && adduser -u 1001 -S nextjs -G nodejs

# standalone omits these two by design — copy them in or static assets 404.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Everything `prisma migrate deploy` needs, kept together under one prefix so
# the CLI, prisma.config.ts, the schema and the migrations all resolve from a
# single working directory — see scripts/start-prod.sh.
COPY --from=migrator --chown=nextjs:nodejs /migrate/node_modules ./.migrate/node_modules
COPY --chown=nextjs:nodejs prisma.config.ts ./.migrate/
COPY --chown=nextjs:nodejs prisma ./.migrate/prisma
COPY --chown=nextjs:nodejs scripts/start-prod.sh ./scripts/start-prod.sh
COPY --chown=nextjs:nodejs scripts/start-app.sh ./scripts/start-app.sh

# Bill images live here when no volume is attached. An attached volume masks
# this directory and arrives root-owned regardless, which is why the ownership
# is re-applied at boot by scripts/start-app.sh rather than trusted from here.
RUN mkdir -p /app/uploads && chown -R nextjs:nodejs /app/uploads

# No `USER nextjs`: the container starts as root solely so start-app.sh can
# chown the uploads mount, then drops to nextjs via su-exec before the server
# starts. Setting USER here would make that chown impossible and put every bill
# upload back to failing with EACCES.
EXPOSE 3000

# Reads $PORT rather than hardcoding 3000: platforms that assign the port
# themselves (Railway) override it, and a probe on the wrong port reports a
# healthy container as dead.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/login" >/dev/null 2>&1 || exit 1

# Plain server start: under compose the one-shot `migrate` service has already
# run and the app must not race it. Railway has no such service and overrides
# this with scripts/start-prod.sh (see railway.json), which execs this same
# script once migrations succeed.
CMD ["sh", "./scripts/start-app.sh"]
