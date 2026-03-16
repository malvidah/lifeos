-- Add recurrence support to tasks table
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence jsonb DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_parent_id uuid DEFAULT NULL REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false;

-- Backfill any NULLs from partial migrations
UPDATE tasks SET is_template = false WHERE is_template IS NULL;

CREATE INDEX IF NOT EXISTS tasks_recurrence_parent_idx ON tasks (recurrence_parent_id) WHERE recurrence_parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_template_idx ON tasks (user_id, is_template) WHERE is_template = true;
