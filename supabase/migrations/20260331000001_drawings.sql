-- Drawings table for the Drawings card whiteboard feature.
-- Stores strokes as JSONB for full editability.
-- Thumbnail is a small base64 PNG for the selector strip.

CREATE TABLE IF NOT EXISTS drawings (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text        NOT NULL DEFAULT 'Untitled',
  strokes     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  thumbnail   text,       -- base64 data URL (120×90 PNG preview)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE INDEX IF NOT EXISTS drawings_user_updated ON drawings(user_id, updated_at DESC);

ALTER TABLE drawings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their drawings"
  ON drawings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
