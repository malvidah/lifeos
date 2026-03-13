#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# lifeos daily backup — dumps the Supabase Postgres DB to ~/lifeos-backups/
#
# Usage:
#   ./scripts/backup.sh              # manual run
#   (cron runs this automatically if set up via: ./scripts/setup-cron.sh)
#
# Restore:
#   ./scripts/restore.sh 2026-03-13
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BACKUP_DIR="$HOME/lifeos-backups"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.local"
DATE=$(date +%Y-%m-%d)
FILE="$BACKUP_DIR/lifeos-$DATE.sql.gz"

# ── Load env ──────────────────────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

# Extract Supabase project ref from the URL
SUPABASE_URL=$(grep 'NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
PROJECT_REF=$(echo "$SUPABASE_URL" | sed 's|https://||;s|\.supabase\.co.*||')
SERVICE_KEY=$(grep 'SUPABASE_SERVICE_ROLE_KEY=' "$ENV_FILE" | cut -d= -f2-)

if [[ -z "$PROJECT_REF" || -z "$SERVICE_KEY" ]]; then
  echo "ERROR: Could not parse PROJECT_REF or SERVICE_KEY from $ENV_FILE" >&2
  exit 1
fi

# Supabase DB connection string (uses the pooler for external connections)
DB_URL="postgresql://postgres.${PROJECT_REF}:${SERVICE_KEY}@aws-0-us-east-1.pooler.supabase.com:5432/postgres"

# ── Backup ────────────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"

echo "[$DATE] Backing up lifeos DB (project: $PROJECT_REF) → $FILE"

# Dump only the tables we care about (entries + projects)
pg_dump "$DB_URL" \
  --no-owner --no-acl \
  --table=entries \
  --table=projects \
  | gzip > "$FILE"

SIZE=$(du -sh "$FILE" | cut -f1)
echo "[$DATE] Done — $SIZE written to $FILE"

# ── Prune old backups (keep last 30 days) ─────────────────────────────────────
find "$BACKUP_DIR" -name "lifeos-*.sql.gz" -mtime +30 -delete
echo "[$DATE] Old backups pruned (kept last 30 days)"
