-- Public profile feature: per-item public flags and a unique-handle index.
--
-- Profile fields (handle, display_name, bio, avatar_url, banner_url,
-- profile_public) live in user_settings.data so we don't need a new table.
-- We DO add a partial unique index over the JSONB-extracted handle so two
-- users can't claim the same handle.

-- ── Per-item visibility flags ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notes' AND column_name = 'is_public'
  ) THEN
    ALTER TABLE notes ADD COLUMN is_public boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trips' AND column_name = 'is_public'
  ) THEN
    ALTER TABLE trips ADD COLUMN is_public boolean NOT NULL DEFAULT false;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS notes_public_idx ON notes (user_id) WHERE is_public = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS trips_public_idx ON trips (user_id) WHERE is_public = true AND deleted_at IS NULL;

-- ── Unique handle ───────────────────────────────────────────────────────────
-- Lowercase, indexed only when actually set; null/empty handles are allowed
-- (users haven't picked one yet).
CREATE UNIQUE INDEX IF NOT EXISTS user_settings_handle_unique
  ON user_settings ((lower(data->>'handle')))
  WHERE data->>'handle' IS NOT NULL AND data->>'handle' <> '';
