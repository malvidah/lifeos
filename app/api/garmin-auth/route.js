import { createClient } from '@supabase/supabase-js';
import { GarminConnect } from 'garmin-connect';

export const runtime = 'nodejs';
export const maxDuration = 30; // Garmin SSO login can take 10–15s

export async function POST(request) {
  const authHeader = request.headers.get('authorization') || '';
  const jwt = authHeader.replace('Bearer ', '').trim();
  if (!jwt) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }
  const { email, password } = body || {};
  if (!email || !password) return Response.json({ error: 'email and password required' }, { status: 400 });

  try {
    const GCClient = new GarminConnect({ username: email, password });
    await GCClient.login();

    // Export OAuth1 + OAuth2 tokens — auto-refresh handled by loadToken() on next fetch
    const tokens = GCClient.exportToken();

    // Load existing settings to merge (don't clobber oura/strava tokens)
    const { data: row } = await supabase
      .from('entries').select('data')
      .eq('type', 'settings').eq('date', 'global').eq('user_id', user.id)
      .maybeSingle();

    await supabase.from('entries').upsert({
      user_id: user.id, date: 'global', type: 'settings',
      data: { ...(row?.data || {}), garminTokens: tokens },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,date,type' });

    return Response.json({ ok: true });
  } catch (e) {
    const msg = e?.message || String(e);
    const isCredErr = msg.includes('401') || msg.includes('Unauthorized')
      || msg.includes('credentials') || msg.includes('password');
    return Response.json({ error: isCredErr ? 'invalid_credentials' : msg },
      { status: isCredErr ? 401 : 500 });
  }
}

export async function DELETE(request) {
  const authHeader = request.headers.get('authorization') || '';
  const jwt = authHeader.replace('Bearer ', '').trim();
  if (!jwt) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: row } = await supabase.from('entries').select('data')
    .eq('type', 'settings').eq('date', 'global').eq('user_id', user.id).maybeSingle();
  const updated = { ...(row?.data || {}) };
  delete updated.garminTokens;

  await supabase.from('entries').upsert({
    user_id: user.id, date: 'global', type: 'settings', data: updated,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,date,type' });

  return Response.json({ ok: true });
}
