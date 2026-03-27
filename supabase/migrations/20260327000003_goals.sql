-- Goals table for Projects & Goals system
CREATE TABLE IF NOT EXISTS goals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id),
  name        text NOT NULL,
  project     text,
  done        boolean DEFAULT false,
  position    int DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, name)
);

ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own goals" ON goals FOR ALL USING (auth.uid() = user_id);
