CREATE TABLE IF NOT EXISTS habit_completions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id),
  habit_id   uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  date       text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(habit_id, date)
);

ALTER TABLE habit_completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own completions" ON habit_completions FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_habit_completions_user_date ON habit_completions(user_id, date);
CREATE INDEX idx_habit_completions_habit ON habit_completions(habit_id);
