#!/usr/bin/env bash
# Restores a database dump and an uploads archive produced by backup.sh.
#
#   ./scripts/restore.sh /var/backups/fms/db-20260726-020000.dump \
#                        /var/backups/fms/uploads-20260726-020000.tar.gz
#
# DESTRUCTIVE: drops and recreates the current database, and replaces the
# contents of the uploads volume. Practise this on a throwaway server before you
# ever need it in anger — an untested backup is not a backup.
set -euo pipefail

DB_DUMP="${1:-}"
UPLOADS_TAR="${2:-}"
PROJECT="${FMS_COMPOSE_PROJECT:-fms}"
PG_USER="${POSTGRES_USER:-fms}"
PG_DB="${POSTGRES_DB:-fms}"

if [[ -z "$DB_DUMP" || -z "$UPLOADS_TAR" ]]; then
  echo "usage: $0 <db-*.dump> <uploads-*.tar.gz>" >&2
  exit 64
fi
for f in "$DB_DUMP" "$UPLOADS_TAR"; do
  [[ -r "$f" ]] || { echo "cannot read $f" >&2; exit 66; }
done

cd "$(dirname "$0")/.."

echo "This will DESTROY the current database and uploads, replacing them with:"
echo "  db      : $DB_DUMP"
echo "  uploads : $UPLOADS_TAR"
read -r -p "Type 'restore' to continue: " confirm
[[ "$confirm" == "restore" ]] || { echo "aborted"; exit 1; }

# Stop the app so nothing writes mid-restore. Postgres stays up.
echo "[$(date -Is)] stopping app ..."
docker compose stop app caddy

# --- database ---------------------------------------------------------------
# Recreate from the maintenance DB so no session holds the target open.
echo "[$(date -Is)] recreating database ..."
docker compose exec -T postgres psql -U "$PG_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS \"$PG_DB\" WITH (FORCE);" \
  -c "CREATE DATABASE \"$PG_DB\" OWNER \"$PG_USER\";"

echo "[$(date -Is)] restoring dump ..."
docker compose exec -T postgres \
  pg_restore -U "$PG_USER" -d "$PG_DB" --no-owner --no-privileges < "$DB_DUMP"

# --- bill images -------------------------------------------------------------
echo "[$(date -Is)] restoring uploads ..."
docker run --rm \
  -v "${PROJECT}_uploads:/dest" \
  -v "$(cd "$(dirname "$UPLOADS_TAR")" && pwd):/in:ro" \
  alpine sh -c "rm -rf /dest/* && tar xzf /in/$(basename "$UPLOADS_TAR") -C /dest"

echo "[$(date -Is)] starting app ..."
docker compose up -d

echo "[$(date -Is)] done. Verify before trusting it:"
echo "  docker compose exec postgres psql -U $PG_USER -d $PG_DB -c 'select count(*) from purchases;'"
echo "  docker compose run --rm migrate npx prisma migrate status"
