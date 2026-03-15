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

  // Try atomic merge via RPC first — falls back to read-then-write if RPC not deployed
  const { data: merged, error: rpcErr } = await supabase.rpc('merge_user_settings', {
    p_user_id: user.id,
    p_patch:   patch,
  });

  if (!rpcErr) return Response.json({ ok: true, data: merged });

  // Fallback: read current, merge, write back
  console.warn('[settings] RPC fallback:', rpcErr.message);
  const { data: row } = await supabase
    .from('user_settings').select('data').eq('user_id', user.id).maybeSingle();
  const current = row?.data ?? {};
  const next = { ...current, ...patch };
  const { error: upsErr } = await supabase
    .from('user_settings')
    .upsert({ user_id: user.id, data: next }, { onConflict: 'user_id' });
  if (upsErr) throw upsErr;
  return Response.json({ ok: true, data: next });
});
