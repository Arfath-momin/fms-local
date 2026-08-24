#!/bin/bash

set -euo pipefail

# ============================================================
# FMS GOOGLE DRIVE BACKUP
#
# Run from cron every 4 hours. Produces, on the remote:
#
#   $REMOTE/database/fms-latest.dump      newest dump, overwritten each run
#   $REMOTE/database/daily/fms-<date>.dump  one kept per calendar day
#   $REMOTE/uploads/                      mirror of the bill-image volume
#
# scripts/restore.sh consumes exactly this layout. If you change a path here,
# change it there — a backup nothing can restore is not a backup.
# ============================================================

PROJECT_DIR="/home/arfath/fms-local"
TEMP_DIR="/home/arfath/fms-temp-backup"

REMOTE="gdrive:FMS-Backup"

DB_BACKUP="$TEMP_DIR/fms-latest.dump"

LOG_FILE="$TEMP_DIR/backup.log"

# How many daily dumps to keep. Four-hourly runs overwrite fms-latest.dump, so
# without these a fault discovered more than four hours late has already had its
# only good copy replaced by a backup of the damage.
KEEP_DAILY_DAYS=30

mkdir -p "$TEMP_DIR"

log() { echo "$*" >> "$LOG_FILE"; }

# Any failure past this point is loud. `set -e` alone exits silently, which on a
# cron job means nobody learns the backup stopped working until the day they
# need it. Cron mails whatever a job writes to stderr, so the message goes to
# the operator as well as the log.
fail() {
    log "BACKUP FAILED at line $1. Nothing was uploaded."
    echo "FMS backup FAILED at line $1 — see $LOG_FILE" >&2
}
trap 'fail $LINENO' ERR

log "========================================"
log "FMS backup started: $(date)"

cd "$PROJECT_DIR"

# ------------------------------------------------------------
# Check PostgreSQL
# ------------------------------------------------------------

# --status=running rather than grepping "Up": the STATUS text also reads "Up"
# for a container that is up but UNHEALTHY, and dumping from one of those is
# how a half-broken database quietly becomes the backup.
if [ -z "$(docker compose ps --status=running --quiet postgres)" ]; then
    log "ERROR: PostgreSQL container is not running."
    exit 1
fi

log "PostgreSQL is running."

# ------------------------------------------------------------
# Create PostgreSQL dump
# ------------------------------------------------------------

log "Creating PostgreSQL backup..."

rm -f "$DB_BACKUP"

docker compose exec -T postgres \
    pg_dump \
    -U fms \
    -d fms \
    --format=custom \
    --no-owner \
    --no-privileges \
    > "$DB_BACKUP"

if [ ! -s "$DB_BACKUP" ]; then
    log "ERROR: Database backup is empty."
    rm -f "$DB_BACKUP"
    exit 1
fi

# ------------------------------------------------------------
# Verify the dump before it is allowed to replace the last good one
# ------------------------------------------------------------
#
# "Non-empty" is a much weaker claim than "restorable". A dump truncated by a
# full disk, a killed container or a dropped exec stream is still non-empty, and
# uploading one overwrites the last copy that WAS restorable — turning a partial
# failure into total data loss. `pg_restore --list` walks the archive's table of
# contents without touching a database, which is the cheapest honest check that
# the file is a complete, readable custom-format archive.

log "Verifying dump is readable..."

# Read through a bind mount rather than piped into `compose exec`: the custom
# format is a seekable archive, and pg_restore cannot walk a TOC arriving on a
# pipe. Same image as the server, so the reader always understands the writer.
TOC_LINES=$(docker run --rm -v "$TEMP_DIR":/verify:ro postgres:18-alpine \
    pg_restore --list /verify/"$(basename "$DB_BACKUP")" 2>>"$LOG_FILE" \
    | grep -c ';' || true)

if [ "${TOC_LINES:-0}" -lt 10 ]; then
    log "ERROR: dump failed verification (table of contents has ${TOC_LINES:-0} entries)."
    log "The previous backup on Google Drive has been LEFT INTACT."
    rm -f "$DB_BACKUP"
    exit 1
fi

DB_SIZE=$(du -h "$DB_BACKUP" | cut -f1)
log "Database dump created and verified: $DB_SIZE, $TOC_LINES TOC entries."

# ------------------------------------------------------------
# Upload database to Google Drive
# ------------------------------------------------------------

log "Uploading database backup to Google Drive..."

rclone copyto "$DB_BACKUP" "$REMOTE/database/fms-latest.dump"

# One dated copy per day, so there is something to go back to when a problem is
# noticed after the four-hourly overwrite has already run. copyto is a no-op
# after the first run of the day, so this costs one upload daily, not six.
TODAY="$(date +%F)"
rclone copyto "$DB_BACKUP" "$REMOTE/database/daily/fms-${TODAY}.dump"

log "Database backup uploaded successfully (latest + daily/fms-${TODAY}.dump)."

# Prune dailies older than the retention window.
CUTOFF="${KEEP_DAILY_DAYS}d"
rclone delete --min-age "$CUTOFF" "$REMOTE/database/daily" >> "$LOG_FILE" 2>&1 || \
    log "WARNING: pruning old daily dumps failed; they are only taking space."

# ------------------------------------------------------------
# Sync uploads to Google Drive
# ------------------------------------------------------------

log "Syncing uploads to Google Drive..."

UPLOAD_TEMP="$TEMP_DIR/uploads"

rm -rf "$UPLOAD_TEMP"
mkdir -p "$UPLOAD_TEMP"

docker run --rm \
    -v fms_uploads:/source:ro \
    -v "$UPLOAD_TEMP":/backup \
    alpine \
    sh -c 'cp -a /source/. /backup/ && chown -R 1000:1000 /backup'

# `rclone sync` makes the destination match the source, DELETIONS INCLUDED. If
# the volume were ever empty — renamed, not yet mounted, a failed `docker run`
# that still exited 0 — an unguarded sync would delete every bill image from
# Drive and call it a success. --max-delete caps how much destruction one run is
# allowed to perform: a genuine tidy-up of a few files still goes through, a
# wipe stops and reports.
LOCAL_FILES=$(find "$UPLOAD_TEMP" -type f | wc -l)
REMOTE_FILES=$(rclone size --json "$REMOTE/uploads" 2>/dev/null | sed -n 's/.*"count":\([0-9]*\).*/\1/p')
REMOTE_FILES="${REMOTE_FILES:-0}"

log "Uploads: ${LOCAL_FILES} local, ${REMOTE_FILES} already on Drive."

if [ "$LOCAL_FILES" -eq 0 ] && [ "$REMOTE_FILES" -gt 0 ]; then
    log "ERROR: the uploads volume looks empty but Drive holds ${REMOTE_FILES} files."
    log "Refusing to sync — that would delete every bill image. Check volume fms_uploads."
    rm -rf "$UPLOAD_TEMP"
    exit 1
fi

rclone sync --max-delete 25 "$UPLOAD_TEMP" "$REMOTE/uploads"

rm -rf "$UPLOAD_TEMP"

log "Uploads synchronized successfully."

# ------------------------------------------------------------
# Remove temporary database dump
# ------------------------------------------------------------

rm -f "$DB_BACKUP"

log "Temporary database backup removed."

# ------------------------------------------------------------
# Show Google Drive status
# ------------------------------------------------------------

log "Google Drive backup status:"

rclone size "$REMOTE" >> "$LOG_FILE"

trap - ERR
log "FMS backup completed successfully: $(date)"
log ""
