-- ─────────────────────────────────────────────────────────────────────────────
-- Add soft-delete support to entries, notes, and tasks.
-- Rows with deleted_at set are excluded from all queries but remain in the DB.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── entries ──────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entries' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE entries ADD COLUMN deleted_at timestamptz DEFAULT NULL;
  END IF;
END $$;

-- ── notes ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notes' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE notes ADD COLUMN deleted_at timestamptz DEFAULT NULL;
  END IF;
END $$;

-- ── tasks ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE tasks ADD COLUMN deleted_at timestamptz DEFAULT NULL;
  END IF;
END $$;

-- ── Partial indexes for fast queries on non-deleted rows ─────────────────────
CREATE INDEX IF NOT EXISTS entries_not_deleted_idx ON entries (user_id, date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS notes_not_deleted_idx   ON notes (user_id)        WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_not_deleted_idx   ON tasks (user_id, date)  WHERE deleted_at IS NULL;
