#!/bin/sh
set -eu

# Startup for platforms that run a single container per service (Railway) and so
# have no equivalent of compose's one-shot `migrate` service. Under compose this
# script is unused — the app image starts with `node server.js` instead.
#
# The migration toolchain is vendored at /app/.migrate by the Dockerfile rather
# than reachable through `npx`: the runtime user is unprivileged with no
# writable npm cache, so an `npx prisma` here would fail every deploy. Running
# from inside that prefix is what makes prisma.config.ts resolve its own
# `prisma/config` and `dotenv` imports, and its relative schema/migrations paths
# point at the copies alongside it.
#
# A failed migration exits non-zero under `set -e`, which aborts the start and
# leaves the previous deployment serving — far better than booting the new code
# against a half-migrated schema.

echo "Applying Prisma migrations..."
cd /app/.migrate
node node_modules/prisma/build/index.js migrate deploy
cd /app

echo "Starting Next.js server..."
exec node server.js
