-- ─────────────────────────────────────────────────────────────────────────────
-- New schema — replaces the single `entries` EAV table with typed tables.
-- Safe to run on a fresh DB (all CREATE TABLE IF NOT EXISTS).
-- Run in Supabase SQL editor or via: supabase db reset
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Shared updated_at trigger function ───────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── 1. user_settings ─────────────────────────────────────────────────────────
-- Replaces entries WHERE type='settings' AND date='global'
-- Stores: oura token, garmin tokens, strava tokens, theme prefs, etc.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data       jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own settings" ON user_settings;
CREATE POLICY "users manage own settings" ON user_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS user_settings_updated_at ON user_settings;
CREATE TRIGGER user_settings_updated_at
  BEFORE UPDATE ON user_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. journal_blocks ────────────────────────────────────────────────────────
-- One paragraph = one row. Day view loads all blocks for a date ordered by
-- position and reconstructs the TipTap doc. Project view queries by project_tags.
CREATE TABLE IF NOT EXISTS journal_blocks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         date        NOT NULL,
  position     integer     NOT NULL DEFAULT 0,
  content      text        NOT NULL DEFAULT '',   -- single paragraph HTML
  project_tags text[]      NOT NULL DEFAULT '{}',
  note_tags    text[]      NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE journal_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own journal" ON journal_blocks;
CREATE POLICY "users manage own journal" ON journal_blocks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS journal_blocks_updated_at ON journal_blocks;
CREATE TRIGGER journal_blocks_updated_at
  BEFORE UPDATE ON journal_blocks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS journal_blocks_user_date_idx ON journal_blocks (user_id, date);
CREATE INDEX IF NOT EXISTS journal_blocks_project_tags_idx ON journal_blocks USING GIN (project_tags);

-- ── 3. tasks ─────────────────────────────────────────────────────────────────
-- One task item = one row.
-- date       = day the task was written
-- due_date   = parsed from "@tomorrow" / "@march 20" syntax, nullable
-- completed_at = date the checkbox was ticked (nullable)
-- Day view shows: tasks WHERE date=X, PLUS open tasks WHERE due_date=X
CREATE TABLE IF NOT EXISTS tasks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         date        NOT NULL,
  due_date     date,
  position     integer     NOT NULL DEFAULT 0,
  text         text        NOT NULL DEFAULT '',
  html         text        NOT NULL DEFAULT '',   -- full TipTap <li> HTML (for re-render)
  done         boolean     NOT NULL DEFAULT false,
  completed_at date,
  project_tags text[]      NOT NULL DEFAULT '{}',
  note_tags    text[]      NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own tasks" ON tasks;
CREATE POLICY "users manage own tasks" ON tasks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS tasks_updated_at ON tasks;
CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS tasks_user_date_idx       ON tasks (user_id, date);
CREATE INDEX IF NOT EXISTS tasks_user_due_date_idx   ON tasks (user_id, due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_user_completed_idx  ON tasks (user_id, completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_project_tags_idx    ON tasks USING GIN (project_tags);

-- ── 4. meal_items ────────────────────────────────────────────────────────────
-- One food item = one row. AI fills ai_protein + ai_calories after entry.
-- Totals are computed at display time (SUM per date).
CREATE TABLE IF NOT EXISTS meal_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         date        NOT NULL,
  position     integer     NOT NULL DEFAULT 0,
  content      text        NOT NULL DEFAULT '',
  ai_protein   numeric,
  ai_calories  integer,
  ai_parsed_at timestamptz,
  project_tags text[]      NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE meal_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own meals" ON meal_items;
CREATE POLICY "users manage own meals" ON meal_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS meal_items_updated_at ON meal_items;
CREATE TRIGGER meal_items_updated_at
  BEFORE UPDATE ON meal_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS meal_items_user_date_idx    ON meal_items (user_id, date);
CREATE INDEX IF NOT EXISTS meal_items_project_tags_idx ON meal_items USING GIN (project_tags);

-- ── 5. notes ─────────────────────────────────────────────────────────────────
-- First-class documents — NOT date-scoped. Notes live in project space.
-- Access: project view (tagged), global view (all). NOT in day view.
-- You can link to a note from journal/tasks using [note title] syntax.
-- project_tags → surfaces in every tagged project's notes section.
CREATE TABLE IF NOT EXISTS notes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        text        NOT NULL DEFAULT '',
  content      text        NOT NULL DEFAULT '',
  project_tags text[]      NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own notes" ON notes;
CREATE POLICY "users manage own notes" ON notes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS notes_updated_at ON notes;
CREATE TRIGGER notes_updated_at
  BEFORE UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS notes_user_created_idx ON notes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notes_project_tags_idx ON notes USING GIN (project_tags);

-- ── 6. events ────────────────────────────────────────────────────────────────
-- Manual events + Google Calendar sync.
-- google_event_id is set when a GCal connection exists.
CREATE TABLE IF NOT EXISTS events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date            date        NOT NULL,
  start_time      time,
  end_time        time,
  title           text        NOT NULL DEFAULT '',
  description     text,
  google_event_id text,
  calendar_id     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own events" ON events;
CREATE POLICY "users manage own events" ON events
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS events_updated_at ON events;
CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS events_user_date_idx ON events (user_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS events_google_dedup_idx
  ON events (user_id, google_event_id) WHERE google_event_id IS NOT NULL;

-- ── 7. workouts ──────────────────────────────────────────────────────────────
-- Supports multiple workouts per day.
-- source: 'strava' | 'oura' | 'garmin' | 'manual'
-- external_id: source's own ID (for dedup on re-sync). NULL for manual entries.
CREATE TABLE IF NOT EXISTS workouts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         date        NOT NULL,
  source       text        NOT NULL DEFAULT 'manual',
  type         text,
  title        text,
  duration_min integer,
  distance_m   numeric,
  calories     integer,
  avg_hr       integer,
  project_tags text[]      NOT NULL DEFAULT '{}',
  external_id  text,
  raw          jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE workouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own workouts" ON workouts;
CREATE POLICY "users manage own workouts" ON workouts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- Partial unique index: dedup synced workouts only (external_id IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS workouts_dedup_idx
  ON workouts (user_id, source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS workouts_user_date_idx    ON workouts (user_id, date);
CREATE INDEX IF NOT EXISTS workouts_project_tags_idx ON workouts USING GIN (project_tags);

-- ── 8. health_metrics ────────────────────────────────────────────────────────
-- Raw health data, one row per source per day.
-- Hierarchy for health card display: oura > apple > garmin
CREATE TABLE IF NOT EXISTS health_metrics (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date        date        NOT NULL,
  source      text        NOT NULL,   -- 'oura' | 'apple' | 'garmin'
  hrv         numeric,
  rhr         integer,
  sleep_hrs   numeric,
  sleep_eff   numeric,                -- 0–100
  steps       integer,
  active_min  integer,
  raw         jsonb,                  -- full source payload
  synced_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date, source)
);
ALTER TABLE health_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own health" ON health_metrics;
CREATE POLICY "users manage own health" ON health_metrics
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS health_metrics_user_date_idx ON health_metrics (user_id, date);

-- ── 9. health_scores ─────────────────────────────────────────────────────────
-- Computed scores (one row per day). winning_source = which health_metrics row
-- was used as input (oura > apple > garmin).
CREATE TABLE IF NOT EXISTS health_scores (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date             date        NOT NULL,
  winning_source   text,
  sleep_score      numeric,
  readiness_score  numeric,
  activity_score   numeric,
  recovery_score   numeric,
  contributors     jsonb,
  calibrated       boolean,
  calibration_days integer,
  computed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);
ALTER TABLE health_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own health scores" ON health_scores;
CREATE POLICY "users manage own health scores" ON health_scores
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS health_scores_user_date_idx ON health_scores (user_id, date);

-- ── 10. day_recaps ───────────────────────────────────────────────────────────
-- AI-generated 1-sentence summaries shown on month calendar view.
CREATE TABLE IF NOT EXISTS day_recaps (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         date        NOT NULL,
  content      text        NOT NULL DEFAULT '',
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);
ALTER TABLE day_recaps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own recaps" ON day_recaps;
CREATE POLICY "users manage own recaps" ON day_recaps
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS day_recaps_user_date_idx ON day_recaps (user_id, date);
