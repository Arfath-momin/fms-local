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

# Retried because Railway's private network is not up the instant the container
# is: for the first second or two `postgres.railway.internal` does not resolve,
# and a migration that runs immediately fails with P1001 against a database that
# is in fact perfectly healthy. A real schema error still fails, just five
# attempts later. `until` shields the condition from `set -e`.
attempt=1
until node node_modules/prisma/build/index.js migrate deploy; do
  if [ "$attempt" -ge 5 ]; then
    echo "Migrations failed after ${attempt} attempts — refusing to start." >&2
    exit 1
  fi
  echo "Attempt ${attempt} failed; retrying in 3s..." >&2
  attempt=$((attempt + 1))
  sleep 3
done

cd /app

# Next's standalone server binds process.env.HOSTNAME. Pinned rather than
# inherited for two reasons: Railway's internal network — the path both its
# healthcheck and its edge proxy take to the container — is IPv6 only, and
# container runtimes set HOSTNAME to the container's own name, which would bind
# a single interface nothing else can route to and serve 502s from a process
# that looks perfectly healthy in the logs. Node opens "::" dual-stack, so IPv4
# callers still connect. Override with BIND_ADDRESS if a host lacks IPv6.
export HOSTNAME="${BIND_ADDRESS:-::}"

# Hands off to the shared launcher, which fixes ownership of the uploads volume
# and drops from root to the nextjs user before starting the server. Migrations
# above therefore run as root — they touch the database only, never the volume.
exec sh /app/scripts/start-app.sh
