-- Add status column to notes (for kanban view)
-- Free-form text so users can define their own workflow per project
-- (e.g. "to do / scripted / filmed / edited" for video ideas).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notes' AND column_name = 'status'
  ) THEN
    ALTER TABLE notes ADD COLUMN status text DEFAULT 'document';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS notes_status_idx ON notes (user_id, status) WHERE deleted_at IS NULL;
