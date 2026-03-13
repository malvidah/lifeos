import { withAuth } from '../_lib/auth.js';

// GET  /api/settings          → { data: { ouraToken, premium, ... } }
// PATCH /api/settings { ...patch } → shallow-merge patch into data, return { ok: true, data: merged }

export const GET = withAuth(async (req, { supabase, user }) => {
  const { data: row, error } = await supabase
    .from('user_settings')
    .select('data')
    .eq('user_id', user.id)
    .single();

  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
  return Response.json({ data: row?.data ?? {} });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const patch = await req.json();

  // Read current data first so we can merge
  const { data: row } = await supabase
    .from('user_settings')
    .select('data')
    .eq('user_id', user.id)
    .single();

  const merged = { ...(row?.data ?? {}), ...patch };

  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: user.id, data: merged }, { onConflict: 'user_id' });

  if (error) throw error;
  return Response.json({ ok: true, data: merged });
});
