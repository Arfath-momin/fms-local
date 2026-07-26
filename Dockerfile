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


# ---- runtime ----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOADS_DIR=/var/lib/fms/uploads

RUN addgroup -g 1001 -S nodejs \
 && adduser -u 1001 -S nextjs -G nodejs

# standalone omits these two by design — copy them in or static assets 404.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Bill images live here on a named volume. Creating it owned by the runtime user
# means Docker seeds the empty volume with the right ownership on first start.
RUN mkdir -p /var/lib/fms/uploads && chown -R nextjs:nodejs /var/lib/fms

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
