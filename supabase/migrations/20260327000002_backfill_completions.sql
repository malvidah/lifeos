-- Backfill habit_completions from existing completion task rows.

CREATE OR REPLACE FUNCTION _temp_clean_task_text(t text) RETURNS text AS $$
BEGIN
  RETURN lower(trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(t, '\{[^}]+\}', '', 'g'),
          '\/[hrnpld]\s+\S+', '', 'gi'),
        E'\\U0001F3AF\\s*[A-Za-z\\u00B7\\s]+', '', 'g'),
      E'\\u21BB\\s*[A-Za-z\\u00B7\\s]+', '', 'g'),
    '@\\d{4}-\\d{2}-\\d{2}', '', 'g'),
  '\\s+', ' ', 'g')));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

INSERT INTO habit_completions (user_id, habit_id, date)
SELECT DISTINCT ON (c.user_id, t.id, c.date)
  c.user_id,
  t.id AS habit_id,
  c.date
FROM tasks c
JOIN tasks t ON t.user_id = c.user_id
  AND t.deleted_at IS NULL
  AND t.html ILIKE '%data-habit=%'
  AND t.html NOT ILIKE '%data-completion="true"%'
  AND t.done = false
  AND _temp_clean_task_text(t.text) = _temp_clean_task_text(c.text)
WHERE c.deleted_at IS NULL
  AND c.html ILIKE '%data-completion="true"%'
  AND c.done = true
ON CONFLICT (habit_id, date) DO NOTHING;

UPDATE tasks
SET deleted_at = now()
WHERE deleted_at IS NULL
  AND html ILIKE '%data-completion="true"%'
  AND done = true;

DROP FUNCTION IF EXISTS _temp_clean_task_text(text);
