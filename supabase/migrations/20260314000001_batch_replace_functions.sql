-- ─────────────────────────────────────────────────────────────────────────────
-- Atomic batch-replace functions for all save endpoints.
-- Wraps DELETE + INSERT in a single transaction to prevent data loss
-- if a crash occurs between the two operations.
--
-- p_date is text (not date) for tasks/meals/workouts because the Supabase
-- JS client may pass date strings that Postgres won't implicitly cast.
-- We cast to date explicitly inside the function body.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── journal_blocks ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION batch_replace_journal_blocks(
  p_user_id uuid,
  p_date    text,
  p_blocks  jsonb DEFAULT '[]'::jsonb
) RETURNS void AS $$
BEGIN
  DELETE FROM journal_blocks WHERE user_id = p_user_id AND date = p_date::date;

  IF jsonb_array_length(p_blocks) > 0 THEN
    INSERT INTO journal_blocks (user_id, date, position, content, project_tags, note_tags)
    SELECT
      p_user_id,
      p_date::date,
      (b->>'position')::integer,
      b->>'content',
      ARRAY(SELECT jsonb_array_elements_text(b->'project_tags')),
      ARRAY(SELECT jsonb_array_elements_text(b->'note_tags'))
    FROM jsonb_array_elements(p_blocks) AS b;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── tasks ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION batch_replace_tasks(
  p_user_id uuid,
  p_date    text,
  p_tasks   jsonb DEFAULT '[]'::jsonb
) RETURNS void AS $$
BEGIN
  DELETE FROM tasks WHERE user_id = p_user_id AND date = p_date::date;

  IF jsonb_array_length(p_tasks) > 0 THEN
    INSERT INTO tasks (user_id, date, position, html, text, done, due_date, completed_at, project_tags, note_tags)
    SELECT
      p_user_id,
      p_date::date,
      (t->>'position')::integer,
      t->>'html',
      t->>'text',
      (t->>'done')::boolean,
      CASE WHEN t->>'due_date' IS NOT NULL THEN (t->>'due_date')::date ELSE NULL END,
      CASE WHEN t->>'completed_at' IS NOT NULL THEN (t->>'completed_at')::date ELSE NULL END,
      ARRAY(SELECT jsonb_array_elements_text(t->'project_tags')),
      ARRAY(SELECT jsonb_array_elements_text(t->'note_tags'))
    FROM jsonb_array_elements(p_tasks) AS t;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── meal_items ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION batch_replace_meal_items(
  p_user_id uuid,
  p_date    text,
  p_items   jsonb DEFAULT '[]'::jsonb
) RETURNS void AS $$
BEGIN
  DELETE FROM meal_items WHERE user_id = p_user_id AND date = p_date::date;

  IF jsonb_array_length(p_items) > 0 THEN
    INSERT INTO meal_items (user_id, date, position, content, ai_calories, ai_protein)
    SELECT
      p_user_id,
      p_date::date,
      (m->>'position')::integer,
      m->>'content',
      CASE WHEN m->>'ai_calories' IS NOT NULL THEN (m->>'ai_calories')::integer ELSE NULL END,
      CASE WHEN m->>'ai_protein'  IS NOT NULL THEN (m->>'ai_protein')::numeric  ELSE NULL END
    FROM jsonb_array_elements(p_items) AS m;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── workouts ────────────────────────────────────────────────────────────────
-- p_sources: which sources to delete (e.g. ['manual'] or ['oura','strava'])
CREATE OR REPLACE FUNCTION batch_replace_workouts(
  p_user_id uuid,
  p_date    text,
  p_sources text[],
  p_rows    jsonb DEFAULT '[]'::jsonb
) RETURNS void AS $$
BEGIN
  DELETE FROM workouts WHERE user_id = p_user_id AND date = p_date::date AND source = ANY(p_sources);

  IF jsonb_array_length(p_rows) > 0 THEN
    INSERT INTO workouts (user_id, date, title, source, calories, raw)
    SELECT
      p_user_id,
      p_date::date,
      w->>'title',
      w->>'source',
      CASE WHEN w->>'calories' IS NOT NULL THEN (w->>'calories')::integer ELSE NULL END,
      CASE WHEN w->'raw' IS NOT NULL THEN w->'raw' ELSE NULL END
    FROM jsonb_array_elements(p_rows) AS w;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Permissions ─────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION batch_replace_journal_blocks(uuid, text, jsonb) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION batch_replace_tasks(uuid, text, jsonb) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION batch_replace_meal_items(uuid, text, jsonb) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION batch_replace_workouts(uuid, text, text[], jsonb) TO authenticated, anon;
