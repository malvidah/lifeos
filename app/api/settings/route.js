import { withAuth } from '../_lib/auth.js';

// GET  /api/settings        → { data: { ouraToken, garminTokens, ... } }
// PATCH /api/settings       → shallow-merges patch into user_settings.data

export const GET = withAuth(async (req, { supabase, user }) => {
  const { data: row, error } = await supabase
    .from('user_settings').select('data').eq('user_id', user.id).single();
  if (error && error.code !== 'PGRST116') throw error;
  return Response.json({ data: row?.data ?? {} });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const patch = await req.json();
  const { data: row } = await supabase
    .from('user_settings').select('data').eq('user_id', user.id).single();
  const merged = { ...(row?.data ?? {}), ...patch };
  const { error } = await supabase.from('user_settings')
    .upsert({ user_id: user.id, data: merged }, { onConflict: 'user_id' });
  if (error) throw error;
  return Response.json({ ok: true, data: merged });
});
