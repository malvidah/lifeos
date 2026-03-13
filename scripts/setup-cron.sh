#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Sets up a daily 2am cron job to run backup.sh automatically.
# Run this once: ./scripts/setup-cron.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup.sh"
LOG_FILE="$HOME/lifeos-backups/backup.log"

chmod +x "$BACKUP_SCRIPT"

# Build the cron line (daily at 2:00 AM)
CRON_LINE="0 2 * * * $BACKUP_SCRIPT >> $LOG_FILE 2>&1"

# Add only if not already present
if crontab -l 2>/dev/null | grep -qF "$BACKUP_SCRIPT"; then
  echo "Cron job already exists — no change made."
else
  (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
  echo "Cron job added:"
  echo "  $CRON_LINE"
  echo ""
  echo "Backups will run daily at 2am and write to ~/lifeos-backups/"
  echo "Log: $LOG_FILE"
fi
