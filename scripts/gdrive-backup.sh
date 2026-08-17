#!/bin/bash

set -euo pipefail

# ============================================================
# FMS GOOGLE DRIVE BACKUP
# ============================================================

PROJECT_DIR="/home/arfath/fms-local"
TEMP_DIR="/home/arfath/fms-temp-backup"

REMOTE="gdrive:FMS-Backup"

DB_BACKUP="$TEMP_DIR/fms-latest.dump"

LOG_FILE="$TEMP_DIR/backup.log"

mkdir -p "$TEMP_DIR"

echo "========================================" >> "$LOG_FILE"
echo "FMS backup started: $(date)" >> "$LOG_FILE"

cd "$PROJECT_DIR"

# ------------------------------------------------------------
# Check PostgreSQL
# ------------------------------------------------------------

if ! docker compose ps postgres | grep -q "Up"; then
    echo "ERROR: PostgreSQL container is not running." >> "$LOG_FILE"
    exit 1
fi

echo "PostgreSQL is running." >> "$LOG_FILE"

# ------------------------------------------------------------
# Create PostgreSQL dump
# ------------------------------------------------------------

echo "Creating PostgreSQL backup..." >> "$LOG_FILE"

rm -f "$DB_BACKUP"

docker compose exec -T postgres \
    pg_dump \
    -U fms \
    -d fms \
    --format=custom \
    --blobs \
    --no-owner \
    --no-privileges \
    > "$DB_BACKUP"

if [ ! -s "$DB_BACKUP" ]; then
    echo "ERROR: Database backup is empty." >> "$LOG_FILE"
    rm -f "$DB_BACKUP"
    exit 1
fi

DB_SIZE=$(du -h "$DB_BACKUP" | cut -f1)

echo "Database dump created: $DB_SIZE" >> "$LOG_FILE"

# ------------------------------------------------------------
# Upload database to Google Drive
# ------------------------------------------------------------

echo "Uploading database backup to Google Drive..." >> "$LOG_FILE"

rclone copyto \
    "$DB_BACKUP" \
    "$REMOTE/database/fms-latest.dump"

echo "Database backup uploaded successfully." >> "$LOG_FILE"

# ------------------------------------------------------------
# Sync uploads to Google Drive
# ------------------------------------------------------------

# ------------------------------------------------------------
# Sync uploads to Google Drive
# ------------------------------------------------------------

echo "Syncing uploads to Google Drive..." >> "$LOG_FILE"

UPLOAD_TEMP="$TEMP_DIR/uploads"

rm -rf "$UPLOAD_TEMP"
mkdir -p "$UPLOAD_TEMP"

docker run --rm \
    -v fms_uploads:/source:ro \
    -v "$UPLOAD_TEMP":/backup \
    alpine \
    sh -c 'cp -a /source/. /backup/ && chown -R 1000:1000 /backup'

rclone sync \
    "$UPLOAD_TEMP" \
    "$REMOTE/uploads"

rm -rf "$UPLOAD_TEMP"

echo "Uploads synchronized successfully." >> "$LOG_FILE"

# ------------------------------------------------------------
# Remove temporary database dump
# ------------------------------------------------------------

rm -f "$DB_BACKUP"

echo "Temporary database backup removed." >> "$LOG_FILE"

# ------------------------------------------------------------
# Show Google Drive status
# ------------------------------------------------------------

echo "Google Drive backup status:" >> "$LOG_FILE"

rclone size "$REMOTE" >> "$LOG_FILE"

echo "FMS backup completed successfully: $(date)" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"
