import { createClient } from '@supabase/supabase-js';

function getUserClient(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return { supabase: null };
  return {
    supabase: createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    )
  };
}

export async function POST(req) {
  const { supabase } = getUserClient(req);
  if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { googleToken, refreshToken } = await req.json();
  if (!googleToken) return Response.json({ error: 'no token' }, { status: 400 });

  // Never overwrite a saved refresh token with null — Google only sends it once
  let finalRefresh = refreshToken || null;
  if (!finalRefresh) {
    const { data: existing } = await supabase.from('entries').select('data')
      .eq('date', '0000-00-00').eq('type', 'google_token').eq('user_id', user.id)
      .maybeSingle();
    finalRefresh = existing?.data?.refreshToken || null;
  }

  const { error } = await supabase.from('entries').upsert(
    { date: '0000-00-00', type: 'google_token', data: { token: googleToken, refreshToken: finalRefresh }, user_id: user.id, updated_at: new Date().toISOString() },
    { onConflict: 'date,type,user_id' }
  );
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

export async function GET(req) {
  const { supabase } = getUserClient(req);
  if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('entries').select('data')
    .eq('date', '0000-00-00').eq('type', 'google_token').eq('user_id', user.id)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({
    googleToken: data?.data?.token || null,
    refreshToken: data?.data?.refreshToken || null,
  });
}
