import { withAuth } from '../_lib/auth.js';

export const POST = withAuth(async (req, { supabase, user }) => {
  const { googleToken, refreshToken } = await req.json();
  if (!googleToken) return Response.json({ error: 'no token' }, { status: 400 });

  // Load existing settings — never overwrite a saved refresh token with null
  const { data: existing } = await supabase.from('user_settings')
    .select('data').eq('user_id', user.id).maybeSingle();

  const finalRefresh = refreshToken || existing?.data?.googleRefreshToken || null;

  const { error } = await supabase.from('user_settings').upsert({
    user_id: user.id,
    data: { ...(existing?.data || {}), googleToken, googleRefreshToken: finalRefresh },
  }, { onConflict: 'user_id' });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
});

export const GET = withAuth(async (req, { supabase, user }) => {
  const { data, error } = await supabase.from('user_settings')
    .select('data').eq('user_id', user.id).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    googleToken:  data?.data?.googleToken        || null,
    refreshToken: data?.data?.googleRefreshToken || null,
  });
});
