-- Add google_task_id for sync tracking
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS google_task_id text DEFAULT NULL;
CREATE INDEX IF NOT EXISTS tasks_google_task_id_idx ON tasks (google_task_id) WHERE google_task_id IS NOT NULL;
