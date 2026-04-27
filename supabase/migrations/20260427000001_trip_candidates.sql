-- Auto-detected trip candidates from Gmail booking emails (and later Calendar/Strava).
-- Pending → user accepts (creates a real trip + stops) or rejects.
-- (user_id, source, source_ref) is unique so re-scanning the same email is a no-op.
CREATE TABLE IF NOT EXISTS trip_candidates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source      text NOT NULL,                                  -- 'gmail' | 'calendar' | 'strava' | 'manual'
  source_ref  text,                                           -- e.g. gmail message id
  status      text NOT NULL DEFAULT 'pending',                -- 'pending' | 'accepted' | 'rejected'
  name        text,                                           -- suggested trip name, e.g. "Trip to Tokyo"
  start_date  date,
  end_date    date,
  stops       jsonb NOT NULL DEFAULT '[]'::jsonb,             -- [{lat?, lng?, label, date_time?, type, raw?}]
  raw         jsonb,                                          -- the original JSON-LD reservation blob
  trip_id     uuid REFERENCES trips(id) ON DELETE SET NULL,   -- set once accepted
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, source, source_ref)
);

ALTER TABLE trip_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own trip candidates" ON trip_candidates FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS trip_candidates_user_status_idx ON trip_candidates (user_id, status, created_at DESC);
