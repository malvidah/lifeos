-- Atomic jsonb merge for user_settings — avoids read-then-write race in PATCH /api/settings
CREATE OR REPLACE FUNCTION merge_user_settings(
  p_user_id uuid,
  p_patch   jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_merged jsonb;
BEGIN
  INSERT INTO user_settings (user_id, data)
  VALUES (p_user_id, p_patch)
  ON CONFLICT (user_id) DO UPDATE
    SET data = user_settings.data || p_patch
  RETURNING data INTO v_merged;

  RETURN v_merged;
END;
$$;
