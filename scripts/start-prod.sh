#!/bin/sh
set -eu

echo "Applying Prisma migrations..."
npx prisma migrate deploy

echo "Starting Next.js server..."
export PORT="${PORT:-3000}"
exec node server.js
