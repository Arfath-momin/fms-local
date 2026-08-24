#!/usr/bin/env bash
# Restores a database dump and the bill images produced by scripts/gdrive-backup.sh.
#
#   ./scripts/restore.sh fms-latest.dump ./uploads
#   ./scripts/restore.sh fms-2026-08-20.dump          # database only
#
# The second argument is optional and may be EITHER a directory (what
# `rclone copy gdrive:FMS-Backup/uploads ./uploads` gives you) or a .tar.gz.
#
# This script used to demand an `uploads-*.tar.gz` and exit 64 without one — an
# archive no backup script has ever produced, from a `backup.sh` that no longer
# exists. The only backups in existence could not be fed to the only restore
# path, which meant the disaster-recovery plan had never worked. It is now
# written against the layout gdrive-backup.sh actually writes.
#
# DESTRUCTIVE: drops and recreates the current database, and replaces the
# contents of the uploads volume. Practise this on a throwaway server before you
# ever need it in anger — an untested backup is not a backup.
#
# To fetch the newest backup from Drive first:
#
#   rclone copy gdrive:FMS-Backup/database/fms-latest.dump .
#   rclone copy gdrive:FMS-Backup/uploads ./uploads
#
# Or, to go back to a particular day:
#
#   rclone lsf gdrive:FMS-Backup/database/daily
#   rclone copy gdrive:FMS-Backup/database/daily/fms-2026-08-20.dump .
set -euo pipefail

DB_DUMP="${1:-}"
UPLOADS_SRC="${2:-}"
PROJECT="${FMS_COMPOSE_PROJECT:-fms}"
PG_USER="${POSTGRES_USER:-fms}"
PG_DB="${POSTGRES_DB:-fms}"

if [[ -z "$DB_DUMP" ]]; then
  echo "usage: $0 <fms-*.dump> [uploads-dir-or-tar.gz]" >&2
  exit 64
fi
[[ -r "$DB_DUMP" ]] || { echo "cannot read $DB_DUMP" >&2; exit 66; }

if [[ -n "$UPLOADS_SRC" && ! -e "$UPLOADS_SRC" ]]; then
  echo "cannot read $UPLOADS_SRC" >&2
  exit 66
fi

cd "$(dirname "$0")/.."

# --- verify the dump BEFORE destroying anything ------------------------------
# Reading the archive's table of contents costs a second and answers the only
# question that matters: is this file actually restorable? Finding that out
# after dropping the live database is how a recoverable incident becomes a
# permanent one.
echo "[$(date -Is)] verifying dump ..."
DUMP_DIR="$(cd "$(dirname "$DB_DUMP")" && pwd)"
DUMP_FILE="$(basename "$DB_DUMP")"
if ! docker run --rm -v "$DUMP_DIR":/verify:ro postgres:18-alpine \
       pg_restore --list "/verify/$DUMP_FILE" > /dev/null 2>&1; then
  echo "REFUSING TO RESTORE: $DB_DUMP is not a readable pg_dump custom-format archive." >&2
  echo "Nothing has been changed. Try another dump from gdrive:FMS-Backup/database/daily." >&2
  exit 65
fi
echo "  dump is readable."

echo
echo "This will DESTROY the current database, replacing it with:"
echo "  db      : $DB_DUMP"
if [[ -n "$UPLOADS_SRC" ]]; then
  echo "  uploads : $UPLOADS_SRC  (replaces the ${PROJECT}_uploads volume)"
else
  echo "  uploads : NOT RESTORED — bill images will be left exactly as they are."
fi
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
# Skipped entirely when no source is given, rather than wiping the volume. A
# database-only restore is a perfectly normal thing to want, and silently
# emptying the image store during one would destroy the bills the restored rows
# point at.
if [[ -n "$UPLOADS_SRC" ]]; then
  echo "[$(date -Is)] restoring uploads ..."
  if [[ -d "$UPLOADS_SRC" ]]; then
    # A directory, as pulled straight off Drive.
    docker run --rm \
      -v "${PROJECT}_uploads:/dest" \
      -v "$(cd "$UPLOADS_SRC" && pwd):/in:ro" \
      alpine sh -c 'rm -rf /dest/* && cp -a /in/. /dest/'
  else
    # A tarball, for anyone restoring from an archive made by hand.
    docker run --rm \
      -v "${PROJECT}_uploads:/dest" \
      -v "$(cd "$(dirname "$UPLOADS_SRC")" && pwd):/in:ro" \
      alpine sh -c "rm -rf /dest/* && tar xzf '/in/$(basename "$UPLOADS_SRC")' -C /dest"
  fi
else
  echo "[$(date -Is)] uploads not supplied — leaving the image volume untouched."
fi

echo "[$(date -Is)] starting app ..."
docker compose up -d

# --- prove it worked ---------------------------------------------------------
# A restore that is not checked is a hope. These three run automatically because
# the moment anyone is running this script is the worst possible moment to be
# remembering commands out of a comment.
echo
echo "[$(date -Is)] verifying restored data ..."

docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -c \
  "SELECT
     (SELECT count(*) FROM purchases)      AS purchases,
     (SELECT count(*) FROM sales)          AS sales,
     (SELECT count(*) FROM ledger_entries) AS ledger_entries,
     (SELECT count(*) FROM users)          AS users;"

echo "[$(date -Is)] checking migration state ..."
docker compose run --rm migrate npx prisma migrate status || \
  echo "WARNING: migrate status reported a problem — the dump may predate the current schema." >&2

echo "[$(date -Is)] checking ledger balances reconcile ..."
docker compose run --rm --entrypoint sh migrate -c "npm run db:verify" || \
  echo "WARNING: ledger verification failed — restored balances do not reconcile." >&2

echo
echo "[$(date -Is)] done. Sign in and spot-check a recent voucher and its bill image."
