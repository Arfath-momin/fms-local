#!/usr/bin/env bash
# Backs up both halves of the application's state. Nothing else holds a copy of
# either — losing them is permanent, so this is not optional once real entries
# exist. Intended for cron:
#
#   0 2 * * * /srv/fms/scripts/backup.sh >> /var/log/fms-backup.log 2>&1
#
# Copy the resulting files off this machine. A backup on the same disk as the
# thing it backs up is not a backup.
set -euo pipefail

DEST="${FMS_BACKUP_DIR:-/var/backups/fms}"
KEEP_DAYS="${FMS_BACKUP_KEEP_DAYS:-30}"
PROJECT="${FMS_COMPOSE_PROJECT:-fms}"
STAMP="$(date +%Y%m%d-%H%M%S)"

cd "$(dirname "$0")/.."
mkdir -p "$DEST"

# --- database ---------------------------------------------------------------
# -Fc is the custom format: compressed, and restorable selectively with pg_restore.
echo "[$(date -Is)] dumping database ..."
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-fms}" -d "${POSTGRES_DB:-fms}" -Fc \
  > "$DEST/db-$STAMP.dump"

# --- bill images -------------------------------------------------------------
# Read-only mount of the named volume; the app keeps running throughout.
echo "[$(date -Is)] archiving uploads ..."
docker run --rm \
  -v "${PROJECT}_uploads:/src:ro" \
  -v "$DEST:/out" \
  alpine tar czf "/out/uploads-$STAMP.tar.gz" -C /src .

# --- retention ---------------------------------------------------------------
find "$DEST" -maxdepth 1 -name 'db-*.dump'        -mtime "+$KEEP_DAYS" -delete
find "$DEST" -maxdepth 1 -name 'uploads-*.tar.gz' -mtime "+$KEEP_DAYS" -delete

echo "[$(date -Is)] done:"
ls -lh "$DEST/db-$STAMP.dump" "$DEST/uploads-$STAMP.tar.gz"
