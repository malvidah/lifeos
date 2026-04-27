-- Make place collections (categories) toggleable as public for the profile page.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_place_types' AND column_name = 'is_public'
  ) THEN
    ALTER TABLE user_place_types ADD COLUMN is_public boolean NOT NULL DEFAULT false;
  END IF;
END $$;
