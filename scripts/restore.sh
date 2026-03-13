#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# lifeos restore — restores entries and projects from a backup file
#
# Usage:
#   ./scripts/restore.sh 2026-03-13        # restore from that date's backup
#   ./scripts/restore.sh                   # shows available backups to pick from
#
# ⚠  WARNING: This UPSERTS backup rows into the live DB. It does NOT wipe
#    the table first — existing rows for dates not in the backup are kept.
#    To wipe and restore cleanly, pass --clean flag.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BACKUP_DIR="$HOME/lifeos-backups"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.local"
CLEAN=false

# Parse args
DATE_ARG=""
for arg in "$@"; do
  case $arg in
    --clean) CLEAN=true ;;
    *) DATE_ARG="$arg" ;;
  esac
done

# ── Show available backups if no date given ───────────────────────────────────
if [[ -z "$DATE_ARG" ]]; then
  echo "Available backups:"
  ls -1t "$BACKUP_DIR"/lifeos-*.sql.gz 2>/dev/null | sed "s|$BACKUP_DIR/lifeos-||;s|\.sql\.gz||" || echo "  (none found in $BACKUP_DIR)"
  echo ""
  echo "Usage: $0 YYYY-MM-DD [--clean]"
  exit 0
fi

FILE="$BACKUP_DIR/lifeos-${DATE_ARG}.sql.gz"
if [[ ! -f "$FILE" ]]; then
  echo "ERROR: Backup file not found: $FILE" >&2
  exit 1
fi

# ── Load env ──────────────────────────────────────────────────────────────────
SUPABASE_URL=$(grep 'NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
PROJECT_REF=$(echo "$SUPABASE_URL" | sed 's|https://||;s|\.supabase\.co.*||')
SERVICE_KEY=$(grep 'SUPABASE_SERVICE_ROLE_KEY=' "$ENV_FILE" | cut -d= -f2-)
DB_URL="postgresql://postgres.${PROJECT_REF}:${SERVICE_KEY}@aws-0-us-east-1.pooler.supabase.com:5432/postgres"

# ── Confirm ───────────────────────────────────────────────────────────────────
echo "About to restore from: $FILE"
echo "Target DB: $PROJECT_REF (LIVE PRODUCTION)"
if [[ "$CLEAN" == "true" ]]; then
  echo "Mode: CLEAN (will TRUNCATE entries and projects before restoring)"
else
  echo "Mode: UPSERT (existing rows not in backup will be kept; use --clean for full restore)"
fi
echo ""
read -p "Type YES to proceed: " CONFIRM
if [[ "$CONFIRM" != "YES" ]]; then
  echo "Aborted."
  exit 1
fi

# ── Restore ───────────────────────────────────────────────────────────────────
if [[ "$CLEAN" == "true" ]]; then
  echo "Truncating tables..."
  psql "$DB_URL" -c "TRUNCATE entries, projects RESTART IDENTITY CASCADE;"
fi

echo "Restoring from $FILE..."
gunzip -c "$FILE" | psql "$DB_URL"
echo "Done."
