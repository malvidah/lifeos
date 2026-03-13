-- ── Entries table ─────────────────────────────────────────────────────────────
-- Stores per-day, per-type data blobs (journal, tasks, meals, etc.)
-- Each row is unique on (user_id, date, type).

CREATE TABLE IF NOT EXISTS entries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date        text        NOT NULL,   -- YYYY-MM-DD
  type        text        NOT NULL,   -- 'journal' | 'tasks' | 'meals' | 'score' | etc.
  data        jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, date, type)
);

-- Row-Level Security
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own entries"
  ON entries FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entries_updated_at
  BEFORE UPDATE ON entries
  FOR EACH ROW EXECUTE FUNCTION update_entries_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS entries_user_date_idx  ON entries (user_id, date DESC);
CREATE INDEX IF NOT EXISTS entries_user_type_idx  ON entries (user_id, type);
