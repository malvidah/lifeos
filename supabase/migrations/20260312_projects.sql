-- ── Projects table ────────────────────────────────────────────────────────────
-- First-class project entities. Each row represents a project the user has
-- explicitly used (via {tag} syntax) or created. Metadata-only overlay over
-- the tag-based system — project existence is still derived from journal/task
-- entries; this table stores color, notes, status, and recency.

CREATE TABLE IF NOT EXISTS projects (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  color       text        DEFAULT NULL,     -- hex override, NULL = use hash fallback
  notes       text        DEFAULT '',
  status      text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  last_active date        DEFAULT NULL,     -- date of most-recent project-view visit
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

-- Row-Level Security
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own projects"
  ON projects FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS projects_user_id_idx ON projects (user_id);
CREATE INDEX IF NOT EXISTS projects_user_status_last_active_idx
  ON projects (user_id, status, last_active DESC NULLS LAST);
