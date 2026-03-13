import { createClient } from '@supabase/supabase-js';
import { GarminConnect } from 'garmin-connect';

export const runtime = 'nodejs';
export const maxDuration = 30; // Garmin SSO login can take 10–15s

function getSupabase(request) {
  const authHeader = request.headers.get('authorization') || '';
  const jwt = authHeader.replace('Bearer ', '').trim();
  if (!jwt) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );
}

export async function POST(request) {
  const supabase = getSupabase(request);
  if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }
  const { email, password } = body || {};
  if (!email || !password) return Response.json({ error: 'email and password required' }, { status: 400 });

  try {
    const GCClient = new GarminConnect({ username: email, password });
    await GCClient.login();
    const tokens = GCClient.exportToken();

    // Load existing settings so we don't clobber other tokens
    const { data: existing } = await supabase.from('user_settings')
      .select('data').eq('user_id', user.id).maybeSingle();

    await supabase.from('user_settings').upsert({
      user_id: user.id,
      data: { ...(existing?.data || {}), garminTokens: tokens },
    }, { onConflict: 'user_id' });

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
  const supabase = getSupabase(request);
  if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: existing } = await supabase.from('user_settings')
    .select('data').eq('user_id', user.id).maybeSingle();
  const updated = { ...(existing?.data || {}) };
  delete updated.garminTokens;

  await supabase.from('user_settings').upsert({
    user_id: user.id, data: updated,
  }, { onConflict: 'user_id' });

  return Response.json({ ok: true });
}
